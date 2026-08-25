import * as z from "zod/v4";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { ToolSpecs } from "../shared/contracts.js";
import type { RelayService } from "./relay.js";

export function createMachineMcpHandler(relay: RelayService) {
  return createMcpHandler(() => {
    const server = new McpServer(
      { name: "mcp-worker", version: "0.1.0" },
      {
        instructions:
          "Tools operate one authorized Windows worker. Read before changing when practical. A local policy decision can require exact-action approval. Never claim a cancelled, expired, or indeterminate mutation succeeded."
      }
    );

    for (const spec of ToolSpecs) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations
        },
        async (argumentsValue, ctx) => {
          try {
            const result = await relay.call(
              spec.name,
              argumentsValue as Record<string, unknown>,
              async (prompt) => {
                try {
                  const answer = await ctx.mcpReq.elicitInput(
                    {
                      mode: "form",
                      message: prompt.summary,
                      requestedSchema: {
                        type: "object",
                        properties: {
                          approve: {
                            type: "boolean",
                            title: "Approve this exact action",
                            default: false
                          }
                        },
                        required: ["approve"]
                      }
                    },
                    { timeout: Math.max(1_000, prompt.expiresAt - Date.now()), signal: ctx.mcpReq.signal }
                  );
                  return answer.action === "accept" && answer.content?.approve === true;
                } catch {
                  return false;
                }
              },
              ctx.mcpReq.signal
            );
            return {
              structuredContent: { ok: true, result },
              content: [{ type: "text" as const, text: JSON.stringify(result) }]
            };
          } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String(error.code) : "TOOL_FAILED";
            const message = error instanceof Error ? error.message : "Tool call failed.";
            return {
              isError: true,
              structuredContent: { ok: false, error: { code, message } },
              content: [{ type: "text" as const, text: `${code}: ${message}` }]
            };
          }
        }
      );
    }
    return server;
  });
}
