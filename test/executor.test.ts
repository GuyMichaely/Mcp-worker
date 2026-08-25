import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerExecutor } from "../src/worker/executor.js";
import { PROTOCOL_VERSION, type RelayJob } from "../src/shared/contracts.js";

const roots: string[] = [];

function job(toolName: string, args: Record<string, unknown>): RelayJob {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    workerId: "w",
    toolName,
    arguments: args,
    requestHash: "a".repeat(64),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    attempt: 1,
    leaseToken: "x".repeat(64),
    correlationId: "c"
  };
}

describe("worker executor", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("writes and reads inside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcp-worker-"));
    roots.push(root);
    const executor = new WorkerExecutor(root);
    await executor.execute(job("file_write", { path: "sub/a.txt", content: "hello", createParents: true }));
    await expect(readFile(join(root, "sub/a.txt"), "utf8")).resolves.toBe("hello");
    await expect(executor.execute(job("file_read", { path: "sub/a.txt" }))).resolves.toEqual({
      path: "sub/a.txt", content: "hello"
    });
  });

  it("rejects absolute paths and traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcp-worker-"));
    roots.push(root);
    const executor = new WorkerExecutor(root);
    await expect(executor.execute(job("file_read", { path: join(root, "x") }))).rejects.toThrow("ABSOLUTE_PATH_DENIED");
    await expect(executor.execute(job("file_read", { path: "../x" }))).rejects.toThrow("PATH_OUTSIDE_WORKSPACE");
  });
});
