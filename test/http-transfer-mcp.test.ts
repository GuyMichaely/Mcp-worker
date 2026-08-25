import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createRemoteApp } from "../src/remote/app.js";
import { RelayService } from "../src/remote/relay.js";
import { RelayStore } from "../src/remote/store.js";
import { sha256 } from "../src/shared/security.js";

const workerToken = "worker-secret";
const mcpToken = "mcp-secret";
const resources: Array<{
  client: Client;
  mcp: ReturnType<typeof createRemoteApp>["mcp"];
  server: Server;
  store: RelayStore;
  directory: string;
}> = [];

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return address.port;
}

function config(directory: string): AppConfig {
  return {
    BIND_HOST: "127.0.0.1",
    PORT: 8787,
    PUBLIC_BASE_URL: "http://127.0.0.1:8787",
    REMOTE_DB_PATH: ":memory:",
    REMOTE_TRANSFER_DIR: directory,
    WORKER_ID: "w",
    WORKER_TOKEN_SHA256: sha256(workerToken),
    WORKER_OFFLINE_AFTER_MS: 45_000,
    JOB_TIMEOUT_MS: 120_000,
    MAX_JSON_BYTES: 1_048_576,
    MAX_FILE_BYTES: 1_048_576,
    TRANSFER_CHUNK_BYTES: 65_536,
    OAUTH_ISSUER: "https://issuer.example",
    OAUTH_AUDIENCE: "mcp-worker",
    OAUTH_JWKS_URI: "http://127.0.0.1:1/jwks",
    OAUTH_REQUIRED_SCOPE: "mcp:tools",
    MCP_DEV_TOKEN_SHA256: sha256(mcpToken)
  };
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.client.close();
    await resource.mcp.close();
    await new Promise<void>((resolve, reject) => resource.server.close((error) => error ? reject(error) : resolve()));
    resource.store.close();
    fs.rmSync(resource.directory, { recursive: true, force: true });
  }
});

describe("HTTP transfer to MCP resource", () => {
  it("uploads chunks through the worker route and reads the completed file through MCP", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-transfer-mcp-"));
    const appConfig = config(directory);
    const store = new RelayStore(":memory:", directory, appConfig.MAX_FILE_BYTES);
    const relay = new RelayService(store, appConfig.WORKER_ID, appConfig.WORKER_OFFLINE_AFTER_MS, appConfig.JOB_TIMEOUT_MS);
    const { app, mcp } = createRemoteApp(appConfig, store, relay);
    const server = createServer(app);
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${mcpToken}`);
        return fetch(url, { ...init, headers });
      }
    });
    const client = new Client(
      { name: "transfer-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(transport);
    resources.push({ client, mcp, server, store, directory });

    const bytes = Buffer.from("uploaded through worker HTTP and read through MCP");
    const first = bytes.subarray(0, 17);
    const second = bytes.subarray(17);
    const id = randomUUID();
    const fileName = "sample file.txt";
    const commonHeaders = {
      authorization: `Bearer ${workerToken}`,
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(fileName),
      "x-mime-type": "text/plain",
      "x-transfer-size": String(bytes.length),
      "x-transfer-sha256": createHash("sha256").update(bytes).digest("hex"),
      "x-transfer-expires-at": new Date(Date.now() + 60_000).toISOString()
    };

    const firstResponse = await fetch(`${baseUrl}/worker/v1/transfers/${id}/chunks`, {
      method: "POST",
      headers: { ...commonHeaders, "x-transfer-offset": "0" },
      body: first
    });
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({ state: "uploading", receivedBytes: first.length });

    const secondResponse = await fetch(`${baseUrl}/worker/v1/transfers/${id}/chunks`, {
      method: "POST",
      headers: { ...commonHeaders, "x-transfer-offset": String(first.length) },
      body: second
    });
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toMatchObject({ state: "ready", receivedBytes: bytes.length });

    const { contents } = await client.readResource({
      uri: `machine-file://transfer/${id}/${encodeURIComponent(fileName)}`
    });
    expect(contents).toEqual([{
      uri: `machine-file://transfer/${id}/${encodeURIComponent(fileName)}`,
      mimeType: "text/plain",
      blob: bytes.toString("base64")
    }]);
  });
});
