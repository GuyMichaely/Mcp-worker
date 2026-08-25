import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import type { RelayJob } from "../shared/contracts.js";
import { getToolSpec } from "../shared/contracts.js";

const MAX_OUTPUT = 1_048_576;
const secretEnvironment = /(token|secret|password|credential|cookie|authorization|api[-_]?key)/i;

export class WorkerExecutor {
  constructor(private readonly workspaceRoot: string) {}

  private localPath(candidate: string): string {
    if (isAbsolute(candidate)) throw new Error("ABSOLUTE_PATH_DENIED");
    const root = resolve(this.workspaceRoot);
    const target = resolve(root, candidate);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
      throw new Error("PATH_OUTSIDE_WORKSPACE");
    }
    return target;
  }

  async execute(job: RelayJob): Promise<unknown> {
    const spec = getToolSpec(job.toolName);
    if (!spec) throw new Error("UNKNOWN_TOOL");
    const input = spec.inputSchema.parse(job.arguments) as Record<string, unknown>;

    if (job.toolName === "machine_status") {
      return {
        platform: os.platform(),
        release: os.release(),
        uptimeSeconds: Math.floor(os.uptime()),
        freeMemoryBytes: os.freemem(),
        totalMemoryBytes: os.totalmem(),
        workspaceRoot: this.workspaceRoot
      };
    }

    if (job.toolName === "file_read") {
      const path = this.localPath(String(input.path));
      const content = await readFile(path, "utf8");
      if (Buffer.byteLength(content) > MAX_OUTPUT) throw new Error("RESULT_TOO_LARGE");
      return { path: String(input.path), content };
    }

    if (job.toolName === "file_write") {
      const path = this.localPath(String(input.path));
      if (input.createParents === true) await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.mcp-worker-${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, String(input.content), { encoding: "utf8", flag: "wx" });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      return { path: String(input.path), bytesWritten: Buffer.byteLength(String(input.content)) };
    }

    if (job.toolName === "process_run") {
      const cwd = this.localPath(typeof input.cwd === "string" ? input.cwd : ".");
      return await this.runProcess(String(input.executable), input.args as string[], cwd, Number(input.timeoutMs));
    }

    throw new Error("UNIMPLEMENTED_TOOL");
  }

  private runProcess(executable: string, args: string[], cwd: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolvePromise, reject) => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !secretEnvironment.test(key)));
      const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let total = 0;
      let finished = false;
      const timer = setTimeout(() => {
        child.kill();
        if (!finished) reject(new Error("PROCESS_TIMEOUT"));
      }, timeoutMs);
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_OUTPUT) {
          child.kill();
          if (!finished) reject(new Error("PROCESS_OUTPUT_LIMIT"));
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.on("error", reject);
      child.on("close", (code, signal) => {
        finished = true;
        clearTimeout(timer);
        resolvePromise({
          exitCode: code,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        });
      });
    });
  }
}
