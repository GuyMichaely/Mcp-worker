import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../src/default-config.js";
import { evaluatePolicy } from "../src/policy.js";

describe("default policy profiles", () => {
  it("allows workspace writes and prompts for workspace deletes", () => {
    const config = createDefaultConfig();
    const file = `${config.paths.workspace}\\notes.txt`;
    expect(evaluatePolicy(config, { tool: "fs_write", capability: "fs.write", subject: { kind: "path", value: file } }).decision).toBe("allow");
    expect(evaluatePolicy(config, { tool: "fs_delete", capability: "fs.delete", subject: { kind: "path", value: file } }).decision).toBe("prompt");
  });

  it("denies writes outside the workspace", () => {
    const config = createDefaultConfig();
    expect(evaluatePolicy(config, {
      tool: "fs_write", capability: "fs.write", subject: { kind: "path", value: "C:\\Windows\\outside.txt" }
    }).decision).toBe("deny");
  });

  it("prompts before sandbox bypass and never changes the requested mode", () => {
    const config = createDefaultConfig();
    expect(evaluatePolicy(config, {
      tool: "process_run", capability: "process.execute.unsandboxed", subject: { kind: "executable", value: "powershell.exe" }
    }).decision).toBe("prompt");
    expect(config.profiles[config.activeProfile]?.processMode).toBe("strict");
  });

  it("makes yolo a visible policy profile", () => {
    const config = { ...createDefaultConfig(), activeProfile: "yolo" };
    expect(evaluatePolicy(config, {
      tool: "fs_delete", capability: "fs.delete", subject: { kind: "path", value: "C:\\anything" }
    }).decision).toBe("allow");
    expect(config.profiles.yolo?.processMode).toBe("policy-only");
  });
});
