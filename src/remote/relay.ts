import type { RelayStore, StoredJob } from "./store.js";
import { getToolSpec } from "../shared/contracts.js";
import { requestHash } from "../shared/security.js";

export interface ApprovalPrompt {
  ticket: string;
  summary: string;
  requestHash: string;
  expiresAt: number;
}

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

  async call(
    toolName: string,
    argumentsValue: Record<string, unknown>,
    approve: (prompt: ApprovalPrompt) => Promise<boolean>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const spec = getToolSpec(toolName);
    if (!spec) throw new RelayError("UNKNOWN_TOOL", `Unknown tool: ${toolName}`);
    const parsed = spec.inputSchema.parse(argumentsValue) as Record<string, unknown>;
    if (!this.store.isWorkerOnline(this.workerId, this.offlineAfterMs)) {
      throw new RelayError("WORKER_OFFLINE", "The Windows worker has not sent a recent heartbeat.");
    }
    const hash = requestHash(toolName, parsed);
    const job = this.store.createJob({
      workerId: this.workerId,
      toolName,
      arguments: parsed,
      requestHash: hash,
      readOnly: spec.readOnly,
      expiresAt: Date.now() + this.timeoutMs
    });
    const abort = () => this.store.cancel(job.id);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      let approvalHandled = false;
      while (true) {
        if (signal?.aborted) throw new RelayError("CANCELLED", "The MCP request was cancelled.");
        const current = this.store.get(job.id)!;
        if (current.state === "completed") return current.result;
        if (current.state === "approval-pending" && !approvalHandled) {
          approvalHandled = true;
          const accepted = await approve({
            ticket: current.approvalTicket!,
            summary: ((current.error as { summary?: string } | undefined)?.summary) ?? `Approve ${toolName}?`,
            requestHash: current.requestHash,
            expiresAt: current.approvalExpiresAt!
          });
          this.store.resumeApproval(current.approvalTicket!, current.requestHash, accepted);
        } else if (["failed", "expired", "cancelled", "indeterminate"].includes(current.state)) {
          const error = current.error as { code?: string; message?: string } | undefined;
          throw new RelayError(error?.code ?? current.state.toUpperCase(), error?.message ?? `Job ended as ${current.state}.`, current);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}
