import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Runtime } from "./runtime.js";
import { NativeClient, sanitizedEnvironment } from "./native-client.js";
import { asMcpResult } from "./mcp-result.js";

const ProcessSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("exec"),
    executable: z.string().min(1),
    args: z.array(z.string()).default([])
  }),
  z.object({
    kind: z.literal("shell"),
    shell: z.enum(["powershell", "cmd"]),
    command: z.string()
  })
]);

const ExecutionModeSchema = z.enum(["profile", "strict", "unsandboxed"]).default("profile");

type ProcessSpec = z.infer<typeof ProcessSpecSchema>;
type Session = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  command: string;
  startedAt: string;
  chunks: { offset: number; stream: "stdout" | "stderr"; text: string }[];
  nextOffset: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

function resolveCommand(spec: ProcessSpec): { executable: string; args: string[]; display: string } {
  if (spec.kind === "exec") {
    return { executable: spec.executable, args: spec.args, display: [spec.executable, ...spec.args].join(" ") };
  }
  if (spec.shell === "powershell") {
    return {
      executable: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", spec.command],
      display: `PowerShell: ${spec.command}`
    };
  }
  return { executable: "cmd.exe", args: ["/d", "/s", "/c", spec.command], display: `cmd: ${spec.command}` };
}

function actualMode(runtime: Runtime, requested: z.infer<typeof ExecutionModeSchema>): "strict" | "unsandboxed" {
  if (requested === "strict" || requested === "unsandboxed") return requested;
  return runtime.config.profiles[runtime.config.activeProfile]?.processMode === "strict" ? "strict" : "unsandboxed";
}

export class ProcessManager {
  private readonly sessions = new Map<string, Session>();
  private readonly native: NativeClient;

  constructor(private readonly runtime: Runtime) {
    this.native = new NativeClient(runtime);
  }

  start(spec: ProcessSpec, cwd: string, environment: Record<string, string>): Session {
    const resolved = resolveCommand(spec);
    const child = spawn(resolved.executable, resolved.args, {
      cwd,
      env: sanitizedEnvironment(environment),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });
    const session: Session = {
      id: crypto.randomUUID(),
      child,
      command: resolved.display,
      startedAt: new Date().toISOString(),
      chunks: [],
      nextOffset: 0,
      exitCode: null,
      signal: null
    };
    const append = (stream: "stdout" | "stderr", data: Buffer) => {
      if (session.nextOffset >= this.runtime.config.limits.maxProcessOutputBytes) return;
      const remaining = this.runtime.config.limits.maxProcessOutputBytes - session.nextOffset;
      const bounded = data.subarray(0, remaining).toString("utf8");
      session.chunks.push({ offset: session.nextOffset, stream, text: bounded });
      session.nextOffset += Buffer.byteLength(bounded);
    };
    child.stdout.on("data", (data: Buffer) => append("stdout", data));
    child.stderr.on("data", (data: Buffer) => append("stderr", data));
    child.on("exit", (code, signal) => { session.exitCode = code; session.signal = signal; });
    this.sessions.set(session.id, session);
    return session;
  }

  async runStrict(
    spec: ProcessSpec,
    cwd: string,
    environment: Record<string, string>,
    timeoutMs: number,
    network: boolean,
    stdin?: string,
    signal?: AbortSignal
  ) {
    const resolved = resolveCommand(spec);
    return this.native.call<Record<string, unknown>>("process.run", {
      executable: resolved.executable,
      args: resolved.args,
      cwd,
      environment,
      timeout_ms: timeoutMs,
      network,
      stdin: stdin ?? "",
      read_write_paths: [this.runtime.config.paths.workspace]
    }, timeoutMs + 10_000, signal);
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown process session: ${id}`);
    return session;
  }

  list() {
    return [...this.sessions.values()].map((session) => ({
      session_id: session.id,
      command: session.command,
      started_at: session.startedAt,
      running: session.exitCode === null && session.signal === null,
      exit_code: session.exitCode,
      signal: session.signal,
      output_bytes: session.nextOffset
    }));
  }
}

export function registerProcessTools(server: McpServer, runtime: Runtime, manager: ProcessManager): void {
  const Common = {
    spec: ProcessSpecSchema,
    cwd: z.string().min(1).default(runtime.config.paths.workspace),
    environment: z.record(z.string(), z.string()).default({}),
    mode: ExecutionModeSchema,
    network: z.boolean().default(true)
  };

  server.registerTool("process_run", {
    title: "Run process",
    description: "Run a program or raw PowerShell/cmd command and wait for it to finish. Strict sandbox failure never falls back to unsandboxed execution.",
    inputSchema: {
      ...Common,
      stdin: z.string().optional(),
      timeout_ms: z.number().int().positive().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }, async ({ spec, cwd, environment, mode, network, stdin, timeout_ms }, extra) => {
    const execution = actualMode(runtime, mode);
    const capability = execution === "strict" ? "process.execute.sandboxed" as const : "process.execute.unsandboxed" as const;
    const resolved = resolveCommand(spec);
    const timeout = Math.min(timeout_ms ?? runtime.config.limits.defaultProcessTimeoutMs, 86_400_000);
    if (network) {
      const networkDecision = await runtime.authorized(server, {
        tool: "process_run", capability: "process.network", subject: { kind: "special", value: "network://outbound" }
      }, `Allow outbound network access for ${resolved.display}`, async () => true);
      if (!networkDecision.ok) return asMcpResult(networkDecision);
    }
    return asMcpResult(await runtime.authorized(server, {
      tool: "process_run", capability, subject: { kind: "executable", value: path.resolve(resolved.executable) }
    }, `Run ${resolved.display} in ${cwd} using ${execution} mode${network ? " with network" : " without network"}`, async () => {
      if (execution === "strict") {
        return manager.runStrict(spec, cwd, environment, timeout, network, stdin, extra.signal);
      }
      const session = manager.start(spec, cwd, environment);
      if (stdin !== undefined) session.child.stdin.end(stdin); else session.child.stdin.end();
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          extra.signal.removeEventListener("abort", abort);
        };
        const abort = () => {
          session.child.kill();
          cleanup();
          reject(new Error("CANCELLED: Process execution was cancelled."));
        };
        const timer = setTimeout(() => {
          session.child.kill();
          cleanup();
          reject(new Error(`Process timed out after ${timeout} ms.`));
        }, timeout);
        if (extra.signal.aborted) {
          abort();
          return;
        }
        extra.signal.addEventListener("abort", abort, { once: true });
        session.child.once("exit", () => { cleanup(); resolve(); });
        session.child.once("error", (error) => { cleanup(); reject(error); });
      });
      return {
        session_id: session.id,
        exit_code: session.exitCode,
        signal: session.signal,
        output: session.chunks,
        truncated: session.nextOffset >= runtime.config.limits.maxProcessOutputBytes
      };
    }));
  });

  server.registerTool("process_start", {
    title: "Start interactive process",
    description: "Start a current-user process session. Strict interactive sessions are not supported yet and fail closed.",
    inputSchema: Common,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }, async ({ spec, cwd, environment, mode, network }) => {
    const execution = actualMode(runtime, mode);
    const resolved = resolveCommand(spec);
    if (network) {
      const networkDecision = await runtime.authorized(server, {
        tool: "process_start", capability: "process.network", subject: { kind: "special", value: "network://outbound" }
      }, `Allow outbound network access for ${resolved.display}`, async () => true);
      if (!networkDecision.ok) return asMcpResult(networkDecision);
    }
    return asMcpResult(await runtime.authorized(server, {
      tool: "process_start",
      capability: execution === "strict" ? "process.execute.sandboxed" : "process.execute.unsandboxed",
      subject: { kind: "executable", value: path.resolve(resolved.executable) }
    }, `Start ${resolved.display} in ${cwd} using ${execution} mode${network ? " with network" : " without network"}`, async () => {
      if (execution === "strict") throw new Error("SANDBOX_INCOMPATIBLE: strict interactive sessions are not implemented. No unsandboxed fallback occurred.");
      const session = manager.start(spec, cwd, environment);
      return { session_id: session.id, pid: session.child.pid, command: session.command, started_at: session.startedAt };
    }));
  });

  server.registerTool("process_poll", {
    title: "Poll process",
    description: "Read new output and status from a process session started by this server.",
    inputSchema: { session_id: z.string().uuid(), after_offset: z.number().int().min(0).default(0) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ session_id, after_offset }) => asMcpResult(await runtime.authorized(server, {
    tool: "process_poll", capability: "machine.status", subject: { kind: "special", value: `process://${session_id}` }
  }, `Poll process session ${session_id}`, async () => {
    const session = manager.get(session_id);
    return {
      session_id,
      running: session.exitCode === null && session.signal === null,
      exit_code: session.exitCode,
      signal: session.signal,
      next_offset: session.nextOffset,
      chunks: session.chunks.filter((chunk) => chunk.offset + Buffer.byteLength(chunk.text) > after_offset)
    };
  })));

  server.registerTool("process_stdin", {
    title: "Write process input",
    description: "Write text to an owned process session, optionally closing stdin.",
    inputSchema: { session_id: z.string().uuid(), text: z.string().default(""), close: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ session_id, text, close }) => asMcpResult(await runtime.authorized(server, {
    tool: "process_stdin", capability: "process.execute.unsandboxed", subject: { kind: "special", value: `process://${session_id}` }
  }, `Write ${Buffer.byteLength(text)} bytes to process session ${session_id}${close ? " and close stdin" : ""}`, async () => {
    const session = manager.get(session_id);
    if (close) session.child.stdin.end(text); else session.child.stdin.write(text);
    return { session_id, bytes_written: Buffer.byteLength(text), closed: close };
  })));

  server.registerTool("process_terminate", {
    title: "Terminate process",
    description: "Terminate a process session owned by this server.",
    inputSchema: { session_id: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ session_id }) => asMcpResult(await runtime.authorized(server, {
    tool: "process_terminate", capability: "process.execute.unsandboxed", subject: { kind: "special", value: `process://${session_id}` }
  }, `Terminate process session ${session_id}`, async () => {
    const session = manager.get(session_id);
    session.child.kill();
    return { session_id, terminated: true };
  })));

  server.registerTool("process_list", {
    title: "List owned processes",
    description: "List process sessions started by this MCP server.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => asMcpResult(await runtime.authorized(server, {
    tool: "process_list", capability: "machine.status", subject: { kind: "special", value: "process://sessions" }
  }, "List MCP-owned process sessions", async () => ({ sessions: manager.list() }))));
}
