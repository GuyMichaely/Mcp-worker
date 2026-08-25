import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeConfig, loadConfig, resolveAppPaths, writeConfigAtomic } from "../src/config.js";

const created: string[] = [];
afterEach(() => {
  for (const directory of created.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("configuration", () => {
  it("initializes and validates all named profiles", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "machine-mcp-test-"));
    created.push(directory);
    const paths = resolveAppPaths(directory);
    const config = initializeConfig(paths);
    expect(Object.keys(config.profiles)).toEqual(["confirm-all", "confirm-mutations", "mostly-unattended", "yolo"]);
    expect(loadConfig(paths).activeProfile).toBe("mostly-unattended");
  });

  it("rejects an unknown active profile", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "machine-mcp-test-"));
    created.push(directory);
    const paths = resolveAppPaths(directory);
    const config = initializeConfig(paths);
    expect(() => writeConfigAtomic(paths, { ...config, activeProfile: "missing" })).toThrow();
  });
});
