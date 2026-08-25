import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuditStore } from "./audit.js";
import { loadConfig, type AppPaths } from "./config.js";
import { evaluatePolicy } from "./policy.js";
import type { AppConfig, PolicyRequest } from "./schema.js";
import { approvalRequired, failure, success, type ToolResult } from "./tool-result.js";

export type ApprovalHandler = (summary: string) => Promise<"approved" | "declined" | "pending">;

export class Runtime {
  config: AppConfig;
  readonly audit: AuditStore;
  approvalHandler?: ApprovalHandler;
  correlationId?: string;

  constructor(readonly paths: AppPaths) {
    this.config = loadConfig(paths);
    this.audit = new AuditStore(paths.databaseFile);
  }

  reload(): AppConfig {
    this.config = loadConfig(this.paths);
    return this.config;
  }

  async authorized<T>(
    server: McpServer,
    request: PolicyRequest,
    summary: string,
    operation: () => Promise<T>
  ): Promise<ToolResult<T>> {
    const started = performance.now();
    const decision = evaluatePolicy(this.config, request);
    let result: ToolResult<T>;

    if (decision.decision === "deny") {
      result = failure("POLICY_DENIED", `Policy denied: ${summary}`, false, decision);
    } else if (decision.decision === "prompt") {
      if (this.approvalHandler) {
        const approval = await this.approvalHandler(summary);
        if (approval === "pending") {
          result = approvalRequired(decision, `Approval required: ${summary}`);
        } else if (approval === "declined") {
          result = failure("USER_DECLINED", `The user did not approve: ${summary}`, false, decision);
        } else {
          try {
            result = success(await operation(), decision);
          } catch (error) {
            result = failure("OPERATION_FAILED", error instanceof Error ? error.message : String(error), false, decision);
          }
        }
      } else {
      let response: Awaited<ReturnType<typeof server.server.elicitInput>>;
      try {
        response = await server.server.elicitInput({
          mode: "form",
          message: `Approve this action?\n\n${summary}`,
          requestedSchema: {
            type: "object",
            properties: {
              approved: {
                type: "boolean",
                title: "Approve",
                description: "Select true to approve this exact action.",
                default: false
              }
            },
            required: ["approved"]
          }
        });
      } catch (error) {
        result = failure(
          "APPROVAL_UNSUPPORTED",
          `The MCP client could not present a trusted approval prompt: ${error instanceof Error ? error.message : String(error)}`,
          false,
          decision
        );
        const auditId = randomUUID();
        result.audit_id = auditId;
        this.audit.record(auditId, decision, result.status, summary, performance.now() - started, this.correlationId);
        return result;
      }
      const approved = response.action === "accept" && response.content?.approved === true;
      if (!approved) {
        result = failure(
          response.action === "decline" ? "USER_DECLINED" : "USER_CANCELLED",
          `The user did not approve: ${summary}`,
          false,
          decision
        );
      } else {
        try {
          result = success(await operation(), decision);
        } catch (error) {
          result = failure("OPERATION_FAILED", error instanceof Error ? error.message : String(error), false, decision);
        }
      }
      }
    } else {
      try {
        result = success(await operation(), decision);
      } catch (error) {
        result = failure("OPERATION_FAILED", error instanceof Error ? error.message : String(error), false, decision);
      }
    }

    const auditId = randomUUID();
    result.audit_id = auditId;
    this.audit.record(auditId, decision, result.status, summary, performance.now() - started, this.correlationId);
    return result;
  }
}
