import type { RelayStore, StoredJob } from "./store.js";
import { getToolSpec } from "../shared/contracts.js";
import { requestHash } from "../shared/security.js";

export interface ApprovalPrompt {
  jobId: string;
  ticket: string;
  summary: string;
  requestHash: string;
  expiresAt: number;
}

export type RelayCallStep =
  | { kind: "completed"; result: unknown }
  | { kind: "approval-required"; prompt: ApprovalPrompt };

export class RelayError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export class RelayService {
  constructor(
    private readonly store: RelayStore,
    private readonly workerId: string,
    private readonly offlineAfterMs: number,
    private readonly timeoutMs: number
  ) {}

  async beginCall(
    toolName: string,
    argumentsValue: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RelayCallStep> {
    const { parsed, hash, readOnly } = this.validateCall(toolName, argumentsValue);
    if (!this.store.isWorkerOnline(this.workerId, this.offlineAfterMs)) {
      throw new RelayError("WORKER_OFFLINE", "The Windows worker has not sent a recent heartbeat.");
    }
    const job = this.store.createJob({
      workerId: this.workerId,
      toolName,
      arguments: parsed,
      requestHash: hash,
      readOnly,
      expiresAt: Date.now() + this.timeoutMs
    });
    return this.waitForStep(job.id, true, signal);
  }

  async resumeCall(
    toolName: string,
    argumentsValue: Record<string, unknown>,
    prompt: Pick<ApprovalPrompt, "jobId" | "ticket" | "requestHash">,
    accepted: boolean,
    signal?: AbortSignal
  ): Promise<unknown> {
    const { hash } = this.validateCall(toolName, argumentsValue);
    if (hash !== prompt.requestHash) {
      throw new RelayError("APPROVAL_MISMATCH", "The resumed action does not match the approved request.");
    }
    const current = this.store.get(prompt.jobId);
    if (
      !current ||
      current.workerId !== this.workerId ||
      current.toolName !== toolName ||
      current.state !== "approval-pending" ||
      current.approvalTicket !== prompt.ticket ||
      current.requestHash !== hash
    ) {
      throw new RelayError("INVALID_APPROVAL", "The approval ticket does not match a pending exact action.");
    }
    try {
      this.store.resumeApproval(prompt.ticket, hash, accepted);
    } catch (error) {
      throw new RelayError("INVALID_APPROVAL", "The approval ticket is invalid or expired.", error);
    }
    const step = await this.waitForStep(prompt.jobId, false, signal);
    if (step.kind !== "completed") throw new RelayError("INVALID_APPROVAL", "The resumed action requested another approval.");
    return step.result;
  }

  async call(
    toolName: string,
    argumentsValue: Record<string, unknown>,
    approve: (prompt: ApprovalPrompt) => Promise<boolean>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const step = await this.beginCall(toolName, argumentsValue, signal);
    if (step.kind === "completed") return step.result;
    const accepted = await approve(step.prompt);
    return this.resumeCall(toolName, argumentsValue, step.prompt, accepted, signal);
  }

  private validateCall(toolName: string, argumentsValue: Record<string, unknown>) {
    const spec = getToolSpec(toolName);
    if (!spec) throw new RelayError("UNKNOWN_TOOL", `Unknown tool: ${toolName}`);
    const parsed = spec.inputSchema.parse(argumentsValue) as Record<string, unknown>;
    return { parsed, hash: requestHash(toolName, parsed), readOnly: spec.readOnly };
  }

  private async waitForStep(jobId: string, stopAtApproval: boolean, signal?: AbortSignal): Promise<RelayCallStep> {
    const abort = () => this.store.cancel(jobId);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        if (signal?.aborted) throw new RelayError("CANCELLED", "The MCP request was cancelled.");
        const current = this.store.get(jobId);
        if (!current) throw new RelayError("JOB_NOT_FOUND", "The relay job no longer exists.");
        if (current.state === "completed") return { kind: "completed", result: current.result };
        if (current.state === "approval-pending" && stopAtApproval) {
          return { kind: "approval-required", prompt: this.approvalPrompt(current) };
        }
        if (["failed", "expired", "cancelled", "indeterminate"].includes(current.state)) {
          const error = current.error as { code?: string; message?: string } | undefined;
          throw new RelayError(error?.code ?? current.state.toUpperCase(), error?.message ?? `Job ended as ${current.state}.`, current);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  private approvalPrompt(current: StoredJob): ApprovalPrompt {
    return {
      jobId: current.id,
      ticket: current.approvalTicket!,
      summary: ((current.error as { summary?: string } | undefined)?.summary) ?? `Approve ${current.toolName}?`,
      requestHash: current.requestHash,
      expiresAt: current.approvalExpiresAt!
    };
  }
}
