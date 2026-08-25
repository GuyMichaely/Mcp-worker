import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { initializeConfig, resolveAppPaths, type AppPaths } from "./config.js";
import { Runtime } from "./runtime.js";
import { createServer } from "./server.js";
import { ProcessManager } from "./process-tools.js";
import { startAdminServer } from "./admin.js";
import { NativeClient } from "./native-client.js";

export class ApprovalNeeded extends Error {
  constructor(readonly summary: string) { super(summary); this.name = "ApprovalNeeded"; }
}

export class WindowsToolError extends Error {
  constructor(readonly code: string, message: string, readonly result?: unknown) {
    super(message); this.name = "WindowsToolError";
  }
}

export interface WindowsToolExecutorOptions { dataDirectory?: string; startAdmin?: boolean }

export class WindowsToolExecutor {
  readonly paths: AppPaths;
  readonly runtime: Runtime;
  private readonly client: Client;
  private readonly admin?: { close: () => Promise<void> };

  private constructor(paths: AppPaths, runtime: Runtime, client: Client, startAdmin: boolean) {
    this.paths = paths; this.runtime = runtime; this.client = client;
    if (startAdmin) this.admin = startAdminServer(runtime);
  }

  static async create(options: WindowsToolExecutorOptions = {}): Promise<WindowsToolExecutor> {
    const paths = resolveAppPaths(options.dataDirectory);
    const config = initializeConfig(paths);
    const fs = await import("node:fs");
    fs.mkdirSync(config.paths.workspace, { recursive: true });
    const runtime = new Runtime(paths);
    const server = createServer(runtime, new ProcessManager(runtime));
    const client = new Client({ name: "relay-worker", version: "0.1.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return new WindowsToolExecutor(paths, runtime, client, options.startAdmin ?? true);
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    approvedSummary?: string,
    correlationId?: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    let requestedSummary: string | undefined;
    this.runtime.approvalHandler = async (summary) => {
      if (approvedSummary !== undefined && approvedSummary === summary) return "approved";
      requestedSummary = summary;
      return "pending";
    };
    this.runtime.correlationId = correlationId;
    let result: CallToolResult;
    try {
      result = await this.client.callTool(
        { name: toolName, arguments: args },
        CallToolResultSchema,
        signal ? { signal } : undefined
      ) as CallToolResult;
    } finally {
      this.runtime.approvalHandler = undefined;
      this.runtime.correlationId = undefined;
    }
    if (requestedSummary !== undefined) throw new ApprovalNeeded(requestedSummary);
    const parsed = parseToolResult(result);
    if (!parsed || parsed.ok !== true) {
      const error = parsed?.error as { code?: string; message?: string } | undefined;
      throw new WindowsToolError(error?.code ?? "LOCAL_TOOL_FAILED", error?.message ?? "The local tool failed.", parsed);
    }
    return parsed;
  }

  async close(): Promise<void> {
    await this.admin?.close();
    await this.client.close();
    this.runtime.audit.close();
  }

  async readWorkerCredential(): Promise<string> {
    const result = await new NativeClient(this.runtime).call<{ secret: string }>("credential.read", {});
    return result.secret;
  }

  async storeWorkerCredential(secret: string): Promise<void> {
    await new NativeClient(this.runtime).call("credential.store", { secret });
  }

  getExport(id: string) {
    return this.runtime.audit.getTransfer(id);
  }
}

function parseToolResult(result: CallToolResult): any {
  const text = result.content.find((item) => item.type === "text");
  if (!text || text.type !== "text") return undefined;
  try { return JSON.parse(text.text); }
  catch { return { ok: !result.isError, data: { content: result.content } }; }
}
