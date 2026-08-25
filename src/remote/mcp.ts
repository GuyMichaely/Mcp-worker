import * as z from "zod/v4";
import { createMcpHandler, McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { ToolSpecs } from "../shared/contracts.js";
import type { RelayService } from "./relay.js";
import type { RelayStore } from "./store.js";

export function createMachineMcpHandler(relay: RelayService, store?: RelayStore) {
  return createMcpHandler(() => {
    const server = new McpServer(
      { name: "mcp-worker", version: "0.1.0" },
      {
        instructions:
          "Tools operate one authorized Windows worker. Read before changing when practical. A local policy decision can require exact-action approval. Never claim a cancelled, expired, or indeterminate mutation succeeded."
      }
    );

    if (store) {
      server.registerResource(
        "worker-export",
        new ResourceTemplate("machine-file://transfer/{id}/{name}", { list: undefined }),
        { title: "Exported Windows file", description: "A short-lived file exported by the authorized Windows worker." },
        async (uri, variables) => {
          const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
          const found = id ? store.readTransfer(id) : undefined;
          if (!found) throw new Error("TRANSFER_NOT_FOUND_OR_EXPIRED");
          return {
            contents: [{
              uri: uri.href,
              mimeType: found.transfer.mimeType,
              blob: found.bytes.toString("base64")
            }]
          };
        }
      );
    }

    for (const spec of ToolSpecs) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations
        },
        async (argumentsValue: unknown, ctx: any) => {
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
            const forwarded = forwardedContent(result);
            return {
              structuredContent: { ok: true, result },
              content: forwarded ?? [{ type: "text" as const, text: JSON.stringify(result) }]
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

function forwardedContent(result: unknown): any[] | undefined {
  if (!result || typeof result !== "object") return undefined;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const allowed = new Set(["text", "image", "audio", "resource", "resource_link"]);
  return content.every((item) => item && typeof item === "object" && allowed.has(String((item as { type?: unknown }).type)))
    ? content
    : undefined;
}
