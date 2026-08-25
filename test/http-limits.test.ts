import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createRemoteApp } from "../src/remote/app.js";
import { RelayService } from "../src/remote/relay.js";
import { RelayStore } from "../src/remote/store.js";
import { requestHash, sha256 } from "../src/shared/security.js";

const workerToken = "worker-secret";
const resources: Array<{
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
    MAX_JSON_BYTES: 512,
    MAX_FILE_BYTES: 1_048_576,
    TRANSFER_CHUNK_BYTES: 65_536,
    OAUTH_ISSUER: "https://issuer.example",
    OAUTH_AUDIENCE: "mcp-worker",
    OAUTH_JWKS_URI: "http://127.0.0.1:1/jwks",
    OAUTH_REQUIRED_SCOPE: "mcp:tools"
  };
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.mcp.close();
    await new Promise<void>((resolve, reject) => resource.server.close((error) => error ? reject(error) : resolve()));
    resource.store.close();
    fs.rmSync(resource.directory, { recursive: true, force: true });
  }
});

describe("remote HTTP limits", () => {
  it("accepts a normal worker result and rejects an oversized JSON result body", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-limits-"));
    const appConfig = config(directory);
    const store = new RelayStore(":memory:", directory, appConfig.MAX_FILE_BYTES);
    const relay = new RelayService(store, appConfig.WORKER_ID, appConfig.WORKER_OFFLINE_AFTER_MS, appConfig.JOB_TIMEOUT_MS);
    const { app, mcp } = createRemoteApp(appConfig, store, relay);
    const server = createServer(app);
    const port = await listen(server);
    resources.push({ mcp, server, store, directory });
    const baseUrl = `http://127.0.0.1:${port}`;

    function createLeasedJob() {
      const args = {};
      const job = store.createJob({
        workerId: "w",
        toolName: "machine_status",
        arguments: args,
        requestHash: requestHash("machine_status", args),
        readOnly: true,
        expiresAt: Date.now() + 60_000
      });
      const leased = store.lease("w");
      if (!leased || leased.id !== job.id) throw new Error("Expected leased test job");
      return leased;
    }

    const small = createLeasedJob();
    const smallResponse = await fetch(`${baseUrl}/worker/v1/jobs/${small.id}/result`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerToken}`,
        "content-type": "application/json",
        "x-lease-token": small.leaseToken
      },
      body: JSON.stringify({ kind: "completed", requestHash: small.requestHash, result: { online: true } })
    });
    expect(smallResponse.status).toBe(200);
    expect(store.get(small.id)?.state).toBe("completed");

    const large = createLeasedJob();
    const largeResponse = await fetch(`${baseUrl}/worker/v1/jobs/${large.id}/result`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerToken}`,
        "content-type": "application/json",
        "x-lease-token": large.leaseToken
      },
      body: JSON.stringify({
        kind: "completed",
        requestHash: large.requestHash,
        result: { output: "x".repeat(appConfig.MAX_JSON_BYTES * 2) }
      })
    });
    expect(largeResponse.status).toBe(413);
    expect(await largeResponse.json()).toEqual({ error: "REQUEST_TOO_LARGE" });
    expect(store.get(large.id)?.state).toBe("leased");
  });
});
