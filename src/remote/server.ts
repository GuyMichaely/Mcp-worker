import { createServer } from "node:http";
import { loadConfig } from "../config.js";
import { createRemoteApp } from "./app.js";
import { RelayService } from "./relay.js";
import { RelayStore } from "./store.js";

const config = loadConfig();
const store = new RelayStore(config.REMOTE_DB_PATH, config.REMOTE_TRANSFER_DIR, config.MAX_FILE_BYTES);
const relay = new RelayService(store, config.WORKER_ID, config.WORKER_OFFLINE_AFTER_MS, config.JOB_TIMEOUT_MS);
const { app, mcp } = createRemoteApp(config, store, relay);
const server = createServer(app);
server.requestTimeout = 95_000;
server.headersTimeout = 100_000;
server.listen(config.PORT, config.BIND_HOST, () => {
  console.log(JSON.stringify({ event: "remote_started", bind: config.BIND_HOST, port: config.PORT }));
});

const maintenance = setInterval(() => {
  store.sweep();
  store.sweepTransfers();
}, 60_000);
maintenance.unref();

async function shutdown(): Promise<void> {
  clearInterval(maintenance);
  await mcp.close();
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
