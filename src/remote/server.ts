import { createServer } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { loadConfig } from "../config.js";
import { requireMcp, requireWorker } from "./auth.js";
import { RelayStore } from "./store.js";
import { RelayService } from "./relay.js";
import { createMachineMcpHandler } from "./mcp.js";
import { RelayJobSchema, WorkerReplySchema } from "../shared/contracts.js";

const config = loadConfig();
const store = new RelayStore(config.REMOTE_DB_PATH);
const relay = new RelayService(store, config.WORKER_ID, config.WORKER_OFFLINE_AFTER_MS, config.JOB_TIMEOUT_MS);
const mcp = createMachineMcpHandler(relay);
const nodeMcp = toNodeHandler(mcp);

const app = createMcpExpressApp({
  host: config.BIND_HOST,
  allowedHosts: config.BIND_HOST === "127.0.0.1" ? undefined : [new URL(config.PUBLIC_BASE_URL).hostname]
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "healthy", protocolVersion: "worker.v1" });
});

app.get("/readyz", (_req, res) => {
  const workerOnline = store.isWorkerOnline(config.WORKER_ID, config.WORKER_OFFLINE_AFTER_MS);
  res.status(workerOnline ? 200 : 503).json({ remote: "ready", worker: workerOnline ? "online" : "offline" });
});

app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: config.PUBLIC_BASE_URL,
    authorization_servers: [config.OAUTH_ISSUER],
    scopes_supported: [config.OAUTH_REQUIRED_SCOPE],
    bearer_methods_supported: ["header"]
  });
});

app.all("/mcp", requireMcp(config), (req, res) => void nodeMcp(req, res, req.body));

const workerAuth = requireWorker(config);

app.post("/worker/v1/heartbeat", workerAuth, (req, res) => {
  const workerId = typeof req.body?.workerId === "string" ? req.body.workerId : "";
  const version = typeof req.body?.version === "string" ? req.body.version : "";
  if (workerId !== config.WORKER_ID || !version) {
    res.status(400).json({ error: "INVALID_HEARTBEAT" });
    return;
  }
  store.heartbeat(workerId, version);
  res.json({ ok: true, serverTime: new Date().toISOString() });
});

app.post("/worker/v1/poll", workerAuth, async (req, res) => {
  if (req.body?.workerId !== config.WORKER_ID) {
    res.status(400).json({ error: "INVALID_WORKER_ID" });
    return;
  }
  const deadline = Date.now() + 25_000;
  let job = store.lease(config.WORKER_ID);
  while (!job && Date.now() < deadline && !req.destroyed) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    job = store.lease(config.WORKER_ID);
  }
  res.json(job ? { job: RelayJobSchema.parse(job) } : { job: null });
});

app.post("/worker/v1/jobs/:id/result", workerAuth, (req, res) => {
  try {
    const leaseToken = req.header("x-lease-token");
    if (!leaseToken) {
      res.status(400).json({ error: "MISSING_LEASE_TOKEN" });
      return;
    }
    const reply = WorkerReplySchema.parse(req.body);
    const job = store.submitReply(req.params.id, leaseToken, reply);
    res.json({ ok: true, state: job.state });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "RESULT_REJECTED" });
  }
});

app.post("/worker/v1/jobs/:id/cancel", workerAuth, (req, res) => {
  const job = store.cancel(req.params.id);
  res.status(job ? 200 : 404).json(job ? { state: job.state } : { error: "JOB_NOT_FOUND" });
});

app.use((error: unknown, _req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, _next: unknown) => {
  const message = error instanceof Error ? error.message : "REQUEST_FAILED";
  res.status(400).json({ error: message });
});

const server = createServer(app);
server.requestTimeout = 95_000;
server.headersTimeout = 100_000;
server.listen(config.PORT, config.BIND_HOST, () => {
  console.log(JSON.stringify({ event: "remote_started", bind: config.BIND_HOST, port: config.PORT }));
});

async function shutdown(): Promise<void> {
  await mcp.close();
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
