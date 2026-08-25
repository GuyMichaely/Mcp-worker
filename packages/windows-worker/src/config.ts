import fs from "node:fs";
import path from "node:path";
import { ConfigSchema, type AppConfig } from "./schema.js";
import { createDefaultConfig } from "./default-config.js";
import { defaultDataDirectory } from "./constants.js";

export type AppPaths = {
  dataDirectory: string;
  configFile: string;
  databaseFile: string;
  logDirectory: string;
  transferDirectory: string;
  trashDirectory: string;
  runDirectory: string;
};

export function resolveAppPaths(dataDirectory = process.env.CHATGPT_MACHINE_MCP_HOME ?? defaultDataDirectory()): AppPaths {
  const resolved = path.resolve(dataDirectory);
  return {
    dataDirectory: resolved,
    configFile: path.join(resolved, "config.json"),
    databaseFile: path.join(resolved, "state.sqlite3"),
    logDirectory: path.join(resolved, "logs"),
    transferDirectory: path.join(resolved, "transfers"),
    trashDirectory: path.join(resolved, "trash"),
    runDirectory: path.join(resolved, "run")
  };
}

export function ensureAppDirectories(paths: AppPaths): void {
  for (const directory of [paths.dataDirectory, paths.logDirectory, paths.transferDirectory, paths.trashDirectory, paths.runDirectory]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function loadConfig(paths: AppPaths): AppConfig {
  if (!fs.existsSync(paths.configFile)) {
    throw new Error(`Configuration not found at ${paths.configFile}. Run setup first.`);
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(paths.configFile, "utf8"));
  return ConfigSchema.parse(parsed);
}

export function writeConfigAtomic(paths: AppPaths, value: unknown): AppConfig {
  const config = ConfigSchema.parse(value);
  ensureAppDirectories(paths);
  const temporary = `${paths.configFile}.${process.pid}.tmp`;
  const backup = `${paths.configFile}.bak`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (fs.existsSync(paths.configFile)) {
    fs.copyFileSync(paths.configFile, backup);
  }
  fs.renameSync(temporary, paths.configFile);
  return config;
}

export function initializeConfig(paths: AppPaths): AppConfig {
  ensureAppDirectories(paths);
  if (fs.existsSync(paths.configFile)) {
    return loadConfig(paths);
  }
  return writeConfigAtomic(paths, createDefaultConfig());
}
