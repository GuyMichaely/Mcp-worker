import { randomBytes } from "node:crypto";
import * as z from "zod/v4";
import {
  acceptedContent,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/server";
import { ToolSpecs } from "../shared/contracts.js";
import type { ApprovalPrompt, RelayCallStep, RelayService } from "./relay.js";
import type { RelayStore } from "./store.js";

interface ApprovalState extends ApprovalPrompt {
  toolName: string;
}

const approvalSchema = z.object({
  approve: z.boolean().meta({ title: "Approve this exact action" })
});

export function createMachineMcpHandler(relay: RelayService, store?: RelayStore) {
  const stateCodec = createRequestStateCodec<ApprovalState>({ key: randomBytes(32), ttlSeconds: 600 });

  return createMcpHandler(() => {
    const server = new McpServer(
      { name: "mcp-worker", version: "0.1.0" },
      {
        instructions:
          "Tools operate one authorized Windows worker. Read before changing when practical. A local policy decision can require exact-action approval. Never claim a cancelled, expired, or indeterminate mutation succeeded.",
        requestState: { verify: stateCodec.verify }
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
            const argumentsObject = argumentsValue as Record<string, unknown>;
            const state = ctx.mcpReq.requestState<ApprovalState>();
            let result: unknown;

            if (state) {
              if (state.toolName !== spec.name) throw new Error("APPROVAL_TOOL_MISMATCH");
              const response = inputResponse(ctx.mcpReq.inputResponses, "approval");
              if (response.kind === "missing") return approvalInput(state, stateCodec);
              const accepted =
                response.kind === "elicit" &&
                response.action === "accept" &&
                acceptedContent(ctx.mcpReq.inputResponses, "approval", approvalSchema)?.approve === true;
              result = await relay.resumeCall(spec.name, argumentsObject, state, accepted, ctx.mcpReq.signal);
            } else {
              const step = await relay.beginCall(spec.name, argumentsObject, ctx.mcpReq.signal);
              if (step.kind === "approval-required") return approvalInput({ ...step.prompt, toolName: spec.name }, stateCodec);
              result = step.result;
            }

            return successfulToolResult(result);
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

async function approvalInput(
  state: ApprovalState,
  stateCodec: ReturnType<typeof createRequestStateCodec<ApprovalState>>
) {
  return inputRequired({
    inputRequests: {
      approval: inputRequired.elicit({ message: state.summary, requestedSchema: approvalSchema })
    },
    requestState: await stateCodec.mint(state)
  });
}

function successfulToolResult(result: unknown) {
  const forwarded = forwardedContent(result);
  return {
    structuredContent: { ok: true, result },
    content: forwarded ?? [{ type: "text" as const, text: JSON.stringify(result) }]
  };
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
