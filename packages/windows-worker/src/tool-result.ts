import { randomUUID } from "node:crypto";
import type { PolicyDecision, ToolError } from "./schema.js";

export type ToolResult<T> = {
  ok: boolean;
  status: "completed" | "denied" | "approval_required" | "failed";
  audit_id: string;
  policy?: Pick<PolicyDecision, "decision" | "profile" | "ruleId">;
  data?: T;
  error?: ToolError;
};

export function success<T>(data: T, decision?: PolicyDecision): ToolResult<T> {
  return {
    ok: true,
    status: "completed",
    audit_id: randomUUID(),
    ...(decision ? { policy: pickPolicy(decision) } : {}),
    data
  };
}

export function failure(code: string, message: string, retryable = false, decision?: PolicyDecision): ToolResult<never> {
  return {
    ok: false,
    status: decision?.decision === "deny" ? "denied" : "failed",
    audit_id: randomUUID(),
    ...(decision ? { policy: pickPolicy(decision) } : {}),
    error: { code, message, retryable }
  };
}

export function approvalRequired(decision: PolicyDecision, message: string): ToolResult<never> {
  return {
    ok: false,
    status: "approval_required",
    audit_id: randomUUID(),
    policy: pickPolicy(decision),
    error: { code: "APPROVAL_REQUIRED", message, retryable: true }
  };
}

function pickPolicy(decision: PolicyDecision): Pick<PolicyDecision, "decision" | "profile" | "ruleId"> {
  return { decision: decision.decision, profile: decision.profile, ruleId: decision.ruleId };
}
