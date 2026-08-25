#!/usr/bin/env node
import fs from "node:fs";
import { initializeConfig, loadConfig, resolveAppPaths, writeConfigAtomic } from "./config.js";
import { Runtime } from "./runtime.js";
import { startMcpHttpServer } from "./server.js";
import { startAdminServer } from "./admin.js";

function usage(): never {
  console.error("Usage: chatgpt-machine-mcp <setup|serve|config-path|validate|profile [name]>");
  process.exit(2);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  const paths = resolveAppPaths();
  if (command === "setup") {
    const config = initializeConfig(paths);
    fs.mkdirSync(config.paths.workspace, { recursive: true });
    console.log(`Configuration: ${paths.configFile}`);
    console.log(`State database: ${paths.databaseFile}`);
    console.log(`Workspace: ${config.paths.workspace}`);
    const runtime = new Runtime(paths);
    runtime.audit.close();
    return;
  }
  if (command === "config-path") {
    console.log(paths.configFile);
    return;
  }
  if (command === "validate") {
    loadConfig(paths);
    console.log(`Valid configuration: ${paths.configFile}`);
    return;
  }
  if (command === "profile") {
    const config = loadConfig(paths);
    const requested = process.argv[3];
    if (!requested) {
      console.log(config.activeProfile);
      return;
    }
    if (!(requested in config.profiles)) throw new Error(`Unknown profile: ${requested}`);
    writeConfigAtomic(paths, { ...config, activeProfile: requested });
    console.log(`Active profile: ${requested}`);
    return;
  }
  if (command !== "serve") usage();
  const runtime = new Runtime(paths);
  const bearerToken = runtime.config.service.requireBearerToken ? process.env.LOCAL_MCP_BEARER_TOKEN : undefined;
  if (runtime.config.service.requireBearerToken && !bearerToken) throw new Error("LOCAL_MCP_BEARER_TOKEN is required when service.requireBearerToken is true.");
  const mcp = startMcpHttpServer(runtime, bearerToken);
  const admin = startAdminServer(runtime);
  console.log(`MCP endpoint: http://${runtime.config.service.host}:${runtime.config.service.port}/mcp`);
  if (admin) console.log(`Local admin: http://${runtime.config.admin.host}:${runtime.config.admin.port}/`);
  const shutdown = async () => {
    await admin?.close();
    await mcp.close();
    runtime.audit.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
