import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalNeeded, WindowsToolExecutor } from "../src/bridge.js";

describe("relay bridge", () => {
  const executors: WindowsToolExecutor[] = [];
  afterEach(async () => {
    await Promise.all(executors.splice(0).map((executor) => executor.close()));
  });

  it("uses local policy and binds approval to the exact summary", async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-worker-bridge-"));
    const executor = await WindowsToolExecutor.create({ dataDirectory, startAdmin: false });
    executors.push(executor);

    await expect(executor.execute("machine_status", {})).resolves.toMatchObject({ ok: true });

    const target = path.join(executor.runtime.config.paths.workspace, `bridge-${Date.now()}.txt`);
    await expect(executor.execute("fs_write", { path: target, text: "bridge test", create_parent: true }))
      .resolves.toMatchObject({ ok: true });

    let summary = "";
    try {
      await executor.execute("fs_delete", { path: target, permanent: false });
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalNeeded);
      summary = (error as ApprovalNeeded).summary;
    }
    expect(summary).not.toBe("");
    await expect(executor.execute("fs_delete", { path: target, permanent: false }, `${summary} changed`))
      .rejects.toBeInstanceOf(ApprovalNeeded);
    await expect(executor.execute("fs_delete", { path: target, permanent: false }, summary))
      .resolves.toMatchObject({ ok: true });
  });

  it.runIf(process.platform === "win32")("aborts an in-flight process and leaves no running session", async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-worker-cancel-"));
    const executor = await WindowsToolExecutor.create({ dataDirectory, startAdmin: false });
    executors.push(executor);
    executor.runtime.config.activeProfile = "yolo";

    const controller = new AbortController();
    const started = Date.now();
    const call = executor.execute("process_run", {
      spec: { kind: "shell", shell: "powershell", command: "Start-Sleep -Seconds 30" },
      cwd: executor.runtime.config.paths.workspace,
      environment: {},
      mode: "unsandboxed",
      network: false,
      timeout_ms: 30_000
    }, undefined, undefined, controller.signal);
    setTimeout(() => controller.abort(), 250);

    await expect(call).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(5_000);
    const processes = await executor.execute("process_list", {}) as { data?: { sessions?: Array<{ running?: boolean }> } };
    expect(processes.data?.sessions?.every((session) => session.running === false)).toBe(true);
  });
});
