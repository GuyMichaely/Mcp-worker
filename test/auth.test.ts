import { createServer, type Server } from "node:http";
import express from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { requireMcp, requireWorker } from "../src/remote/auth.js";
import { sha256 } from "../src/shared/security.js";

const workerToken = "worker-secret";
const devMcpToken = "mcp-dev-secret";
const issuer = "https://issuer.example";
const audience = "mcp-worker";
const requiredScope = "mcp:tools";

let signingKey: CryptoKey;
let jwksServer: Server;
let appServer: Server;
let baseUrl: string;
let config: AppConfig;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

async function token(overrides: {
  issuer?: string;
  audience?: string;
  scope?: string;
  expiresIn?: string;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ scope: overrides.scope ?? requiredScope })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setIssuedAt(now);

  if (overrides.expiresIn === "expired") jwt.setExpirationTime(now - 60);
  else jwt.setExpirationTime(now + 300);
  return jwt.sign(signingKey);
}

async function request(path: string, bearer?: string) {
  const init: RequestInit = { method: "POST" };
  if (bearer) init.headers = { authorization: `Bearer ${bearer}` };
  return fetch(`${baseUrl}${path}`, init);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  jwksServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  const jwksPort = await listen(jwksServer);

  config = {
    BIND_HOST: "127.0.0.1",
    PORT: 8787,
    PUBLIC_BASE_URL: "https://mcp.example",
    REMOTE_DB_PATH: ":memory:",
    REMOTE_TRANSFER_DIR: "./data/transfers",
    WORKER_ID: "w",
    WORKER_TOKEN_SHA256: sha256(workerToken),
    WORKER_OFFLINE_AFTER_MS: 45_000,
    JOB_TIMEOUT_MS: 120_000,
    MAX_JSON_BYTES: 1_048_576,
    MAX_FILE_BYTES: 268_435_456,
    TRANSFER_CHUNK_BYTES: 1_048_576,
    OAUTH_ISSUER: issuer,
    OAUTH_AUDIENCE: audience,
    OAUTH_JWKS_URI: `http://127.0.0.1:${jwksPort}/jwks`,
    OAUTH_REQUIRED_SCOPE: requiredScope,
    MCP_DEV_TOKEN_SHA256: sha256(devMcpToken)
  };

  const app = express();
  app.post("/mcp", requireMcp(config), (_req, res) => res.json({ ok: true }));
  app.post("/worker", requireWorker(config), (_req, res) => res.json({ ok: true }));
  appServer = createServer(app);
  const port = await listen(appServer);
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => jwksServer.close((error) => error ? reject(error) : resolve()))
  ]);
});

describe("remote route authentication", () => {
  it("rejects a missing MCP access token with a protected-resource challenge", async () => {
    const response = await request("/mcp");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "MISSING_ACCESS_TOKEN" });
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"'
    );
  });

  it("rejects a malformed MCP access token", async () => {
    const response = await request("/mcp", "not-a-jwt");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_ACCESS_TOKEN" });
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("rejects an expired MCP access token", async () => {
    const response = await request("/mcp", await token({ expiresIn: "expired" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_ACCESS_TOKEN" });
  });

  it("rejects an MCP access token for the wrong audience", async () => {
    const response = await request("/mcp", await token({ audience: "other-service" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_ACCESS_TOKEN" });
  });

  it("rejects an MCP access token for the wrong issuer", async () => {
    const response = await request("/mcp", await token({ issuer: "https://other-issuer.example" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_ACCESS_TOKEN" });
  });

  it("rejects an MCP access token without the required scope", async () => {
    const response = await request("/mcp", await token({ scope: "profile other:scope" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_ACCESS_TOKEN" });
  });

  it("accepts a valid scoped MCP access token", async () => {
    const response = await request("/mcp", await token());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("accepts the configured MCP development token only on the MCP route", async () => {
    const mcp = await request("/mcp", devMcpToken);
    expect(mcp.status).toBe(200);
    const worker = await request("/worker", devMcpToken);
    expect(worker.status).toBe(401);
    expect(await worker.json()).toEqual({ error: "UNAUTHORIZED_WORKER" });
  });

  it("accepts the worker token only on worker routes", async () => {
    const worker = await request("/worker", workerToken);
    expect(worker.status).toBe(200);
    const mcp = await request("/mcp", workerToken);
    expect(mcp.status).toBe(401);
    expect(await mcp.json()).toEqual({ error: "INVALID_ACCESS_TOKEN" });
  });
});
