import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { Request, Response } from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { APP_NAME, APP_VERSION } from "./constants.js";
import type { Runtime } from "./runtime.js";
import { registerFileTools } from "./file-tools.js";
import { ProcessManager, registerProcessTools } from "./process-tools.js";
import { registerDesktopTools } from "./desktop-tools.js";
import { asMcpResult } from "./mcp-result.js";
import { evaluatePolicy } from "./policy.js";

function safeTokenEqual(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerAuthorized(request: Request, runtime: Runtime, expected: string | undefined): boolean {
  if (!runtime.config.service.requireBearerToken) return true;
  if (!expected) return false;
  const authorization = request.header("authorization") ?? "";
  return authorization.startsWith("Bearer ") && safeTokenEqual(authorization.slice(7), expected);
}

export function createServer(runtime: Runtime, processManager: ProcessManager): McpServer {
  const server = new McpServer({ name: APP_NAME, version: APP_VERSION }, {
    capabilities: { logging: {} },
    instructions: "Operate the user's Windows machine only through these tools. Treat policy denials and approval failures as final; never work around them."
  });

  server.registerTool("machine_status", {
    title: "Machine service status",
    description: "Report service, workspace, active policy, and native-helper status.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => asMcpResult(await runtime.authorized(server, {
    tool: "machine_status", capability: "machine.status", subject: { kind: "special", value: "machine://local" }
  }, "Inspect machine MCP status", async () => ({
    service: APP_NAME,
    version: APP_VERSION,
    workspace: runtime.config.paths.workspace,
    active_profile: runtime.config.activeProfile,
    process_mode: runtime.config.profiles[runtime.config.activeProfile]?.processMode,
    data_directory: runtime.paths.dataDirectory
  }))));

  server.registerTool("policy_explain", {
    title: "Explain policy decision",
    description: "Preview the exact policy decision for a proposed tool capability and subject without performing it.",
    inputSchema: {
      tool: z.string().min(1),
      capability: z.enum([
        "machine.status", "policy.inspect", "fs.read", "fs.create", "fs.write", "fs.delete",
        "process.execute.sandboxed", "process.execute.unsandboxed", "process.network",
        "desktop.observe", "desktop.control", "clipboard.read", "clipboard.write",
        "transfer.import", "transfer.export"
      ]),
      subject_kind: z.enum(["path", "executable", "app", "special"]).optional(),
      subject_value: z.string().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ tool, capability, subject_kind, subject_value }) => {
    const proposed = {
      tool,
      capability,
      ...(subject_kind && subject_value ? { subject: { kind: subject_kind, value: subject_value } } : {})
    };
    const inspection = await runtime.authorized(server, {
      tool: "policy_explain", capability: "policy.inspect", subject: { kind: "special", value: "policy://active" }
    }, "Inspect the active policy", async () => evaluatePolicy(runtime.config, proposed));
    return asMcpResult(inspection);
  });

  registerFileTools(server, runtime);
  registerProcessTools(server, runtime, processManager);
  registerDesktopTools(server, runtime);
  server.registerResource("exported-machine-file", new ResourceTemplate("machine-file://transfer/{id}/{name}", { list: undefined }), {
    title: "Exported machine file",
    description: "A short-lived file explicitly exported from the local machine.",
    mimeType: "application/octet-stream"
  }, async (uri, variables) => {
    const transfer = runtime.audit.getTransfer(String(variables.id));
    if (!transfer || new Date(transfer.expiresAt).getTime() < Date.now() || !fs.existsSync(transfer.localPath)) {
      throw new Error("The exported file is missing or expired.");
    }
    return { contents: [{ uri: uri.toString(), blob: fs.readFileSync(transfer.localPath).toString("base64"), mimeType: "application/octet-stream" }] };
  });
  return server;
}

export function startMcpHttpServer(runtime: Runtime, bearerToken?: string): { close: () => Promise<void> } {
  const app = createMcpExpressApp({ host: runtime.config.service.host });
  const processManager = new ProcessManager(runtime);
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.use("/mcp", (request: Request, response: Response, next) => {
    if (!bearerAuthorized(request, runtime, bearerToken)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  app.post("/mcp", async (request: Request, response: Response) => {
    try {
      const sessionId = request.header("mcp-session-id");
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport && !sessionId && isInitializeRequest(request.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => { transports.set(id, transport!); }
        });
        transport.onclose = () => {
          if (transport?.sessionId) transports.delete(transport.sessionId);
        };
        await createServer(runtime, processManager).connect(transport);
      }
      if (!transport) {
        response.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing MCP session." }, id: null });
        return;
      }
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) response.status(500).json({
        jsonrpc: "2.0", error: { code: -32603, message: error instanceof Error ? error.message : String(error) }, id: null
      });
    }
  });

  for (const method of ["get", "delete"] as const) {
    app[method]("/mcp", async (request: Request, response: Response) => {
      const sessionId = request.header("mcp-session-id");
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        response.status(400).send("Invalid or missing MCP session.");
        return;
      }
      await transport.handleRequest(request, response);
    });
  }

  app.get("/health", (_request: Request, response: Response) => response.json({ ok: true, service: APP_NAME, version: APP_VERSION }));
  const listener = app.listen(runtime.config.service.port, runtime.config.service.host);
  return {
    close: async () => {
      await Promise.all([...transports.values()].map((transport) => transport.close()));
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  };
}
