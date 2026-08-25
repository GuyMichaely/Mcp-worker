import os from "node:os";
import path from "node:path";

export const APP_NAME = "chatgpt-machine-mcp";
export const APP_VERSION = "0.1.0";
export const DEFAULT_ADMIN_PORT = 47321;

export function defaultDataDirectory(): string {
  return path.join(os.homedir(), "chatgpt-machine-mcp");
}

export function defaultWorkspaceDirectory(): string {
  return path.join(os.homedir(), "projects", "pluginworkspace");
}
