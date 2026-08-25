import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import { z } from "zod";
import { ApprovalNeeded, WindowsToolError, WindowsToolExecutor } from "@mcp-worker/windows-worker/bridge";
import { RelayJobSchema, WorkerReplySchema, type JobState, type WorkerReply } from "../shared/contracts.js";
import { PolicyEngine } from "./policy.js";

const WorkerEnvironment = z.object({
  RELAY_URL: z.string().url(),
  WORKER_ID: z.string().min(1).default("primary-windows"),
  WORKER_TOKEN: z.string().min(32).optional(),
  WORKER_DATA_DIRECTORY: z.string().min(1).optional(),
  POLL_SECONDS: z.coerce.number().int().min(5).max(30).default(25)
});

const config = WorkerEnvironment.parse(process.env);
const executor = await WindowsToolExecutor.create({
  ...(config.WORKER_DATA_DIRECTORY ? { dataDirectory: config.WORKER_DATA_DIRECTORY } : {}),
  startAdmin: true
});
const workerToken = config.WORKER_TOKEN ?? await executor.readWorkerCredential();
if (workerToken.length < 32) throw new Error("The worker credential must contain at least 32 characters.");
const policy = new PolicyEngine();
const headers = { authorization: `Bearer ${workerToken}`, "content-type": "application/json" };
const cancellationStates = new Set<JobState>(["cancelled", "indeterminate", "expired"]);

async function post(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(new URL(path, config.RELAY_URL), {
    method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body), signal: AbortSignal.timeout(35_000)
  });
}

async function jobState(jobId: string, signal?: AbortSignal): Promise<JobState | undefined> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(5_000)])
    : AbortSignal.timeout(5_000);
  const response = await fetch(new URL(`/worker/v1/jobs/${jobId}/state`, config.RELAY_URL), {
    method: "GET",
    headers: { authorization: `Bearer ${workerToken}` },
    signal: requestSignal
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`JOB_STATE_${response.status}`);
  return (await response.json() as { state: JobState }).state;
}

async function watchCancellation(jobId: string, execution: AbortController, stop: AbortSignal): Promise<void> {
  while (!stop.aborted && !execution.signal.aborted) {
    try {
      await delay(250, undefined, { signal: stop });
    } catch {
      return;
    }
    try {
      const state = await jobState(jobId, stop);
      if (state === undefined || cancellationStates.has(state)) {
        execution.abort();
        return;
      }
    } catch (error) {
      if (stop.aborted) return;
      console.error(JSON.stringify({
        event: "cancellation_watch_error",
        jobId,
        message: error instanceof Error ? error.message : "unknown"
      }));
    }
  }
}

async function heartbeat(): Promise<void> {
  const response = await post("/worker/v1/heartbeat", { workerId: config.WORKER_ID, version: "0.1.0" });
  if (!response.ok) throw new Error(`HEARTBEAT_${response.status}`);
}

async function submit(jobId: string, leaseToken: string, reply: WorkerReply): Promise<void> {
  const response = await post(`/worker/v1/jobs/${jobId}/result`, WorkerReplySchema.parse(reply), { "x-lease-token": leaseToken });
  if (response.ok) return;
  if (response.status === 409) {
    const state = await jobState(jobId);
    if (state !== undefined && cancellationStates.has(state)) return;
  }
  throw new Error(`RESULT_REJECTED_${response.status}`);
}

async function handle(raw: unknown): Promise<void> {
  const job = RelayJobSchema.parse(raw);
  const approvedSummary = job.approval ? policy.consumeApproval(job) : undefined;
  if (job.approval && approvedSummary === undefined) {
    await submit(job.id, job.leaseToken, {
      kind: "failed", requestHash: job.requestHash,
      error: { code: "INVALID_APPROVAL", message: "Approval was missing, expired, reused, or bound to another request.", retryable: false }
    });
    return;
  }

  const execution = new AbortController();
  const watcherStop = new AbortController();
  const watcher = watchCancellation(job.id, execution, watcherStop.signal);
  try {
    const result = await executor.execute(job.toolName, job.arguments, approvedSummary, job.correlationId, execution.signal);
    if (execution.signal.aborted) return;
    await uploadExports(result, execution.signal);
    if (execution.signal.aborted) return;
    await submit(job.id, job.leaseToken, { kind: "completed", requestHash: job.requestHash, result });
  } catch (error) {
    if (execution.signal.aborted) return;
    if (error instanceof ApprovalNeeded) {
      const approval = policy.createApproval(job, error.summary);
      await submit(job.id, job.leaseToken, {
        kind: "approval-required", requestHash: job.requestHash, ticket: approval.ticket,
        summary: approval.summary, expiresAt: new Date(approval.expiresAt).toISOString()
      });
      return;
    }
    const code = error instanceof WindowsToolError ? error.code : "EXECUTION_FAILED";
    const message = error instanceof Error ? error.message : "Execution failed.";
    await submit(job.id, job.leaseToken, {
      kind: "failed", requestHash: job.requestHash, error: { code, message, retryable: false }
    });
  } finally {
    watcherStop.abort();
    await watcher;
  }
}

async function uploadExports(result: unknown, signal?: AbortSignal): Promise<void> {
  const content = (result as { data?: { content?: unknown[] } } | undefined)?.data?.content;
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "resource_link") continue;
    const uri = String((item as { uri?: unknown }).uri ?? "");
    const match = /^machine-file:\/\/transfer\/([0-9a-f-]{36})\//i.exec(uri);
    if (!match?.[1]) continue;
    const transfer = executor.getExport(match[1]);
    if (!transfer) throw new Error("LOCAL_TRANSFER_NOT_FOUND");
    const handle = fs.openSync(transfer.localPath, "r");
    try {
      const chunkBytes = 1_048_576;
      let offset = 0;
      do {
        if (signal?.aborted) throw new Error("CANCELLED: Transfer upload was cancelled.");
        const buffer = Buffer.alloc(Math.min(chunkBytes, Math.max(0, transfer.size - offset)));
        const count = buffer.length ? fs.readSync(handle, buffer, 0, buffer.length, offset) : 0;
        const requestSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(35_000)])
          : AbortSignal.timeout(35_000);
        const response = await fetch(new URL(`/worker/v1/transfers/${match[1]}/chunks`, config.RELAY_URL), {
          method: "POST",
          headers: {
            authorization: `Bearer ${workerToken}`,
            "content-type": "application/octet-stream",
            "x-file-name": encodeURIComponent(transfer.fileName),
            "x-mime-type": "application/octet-stream",
            "x-transfer-size": String(transfer.size),
            "x-transfer-sha256": transfer.sha256,
            "x-transfer-expires-at": transfer.expiresAt,
            "x-transfer-offset": String(offset)
          },
          body: buffer.subarray(0, count),
          signal: requestSignal
        });
        if (!response.ok) throw new Error(`TRANSFER_UPLOAD_${response.status}: ${await response.text()}`);
        offset += count;
      } while (offset < transfer.size);
    } finally { fs.closeSync(handle); }
  }
}

let failures = 0;
let nextHeartbeat = 0;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; });

try {
  while (!stopping) {
    try {
      if (Date.now() >= nextHeartbeat) {
        await heartbeat();
        nextHeartbeat = Date.now() + 15_000;
      }
      const response = await post("/worker/v1/poll", { workerId: config.WORKER_ID, waitSeconds: config.POLL_SECONDS });
      if (!response.ok) throw new Error(`POLL_${response.status}`);
      const payload = await response.json() as { job: unknown | null };
      if (payload.job) await handle(payload.job);
      failures = 0;
    } catch (error) {
      failures += 1;
      const base = Math.min(30_000, 500 * 2 ** Math.min(failures, 6));
      const jitter = Math.floor(Math.random() * 500);
      console.error(JSON.stringify({ event: "worker_error", message: error instanceof Error ? error.message : "unknown" }));
      await delay(base + jitter);
    }
  }
} finally { await executor.close(); }
