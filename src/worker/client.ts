import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { ApprovalNeeded, WindowsToolError, WindowsToolExecutor } from "@mcp-worker/windows-worker/bridge";
import { RelayJobSchema, WorkerReplySchema, type WorkerReply } from "../shared/contracts.js";
import { PolicyEngine } from "./policy.js";

const WorkerEnvironment = z.object({
  RELAY_URL: z.string().url(),
  WORKER_ID: z.string().min(1).default("primary-windows"),
  WORKER_TOKEN: z.string().min(32),
  WORKER_DATA_DIRECTORY: z.string().min(1).optional(),
  POLL_SECONDS: z.coerce.number().int().min(5).max(30).default(25)
});

const config = WorkerEnvironment.parse(process.env);
const executor = await WindowsToolExecutor.create({
  ...(config.WORKER_DATA_DIRECTORY ? { dataDirectory: config.WORKER_DATA_DIRECTORY } : {}),
  startAdmin: true
});
const policy = new PolicyEngine();
const headers = { authorization: `Bearer ${config.WORKER_TOKEN}`, "content-type": "application/json" };

async function post(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(new URL(path, config.RELAY_URL), {
    method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body), signal: AbortSignal.timeout(35_000)
  });
}

async function heartbeat(): Promise<void> {
  const response = await post("/worker/v1/heartbeat", { workerId: config.WORKER_ID, version: "0.1.0" });
  if (!response.ok) throw new Error(`HEARTBEAT_${response.status}`);
}

async function submit(jobId: string, leaseToken: string, reply: WorkerReply): Promise<void> {
  const response = await post(`/worker/v1/jobs/${jobId}/result`, WorkerReplySchema.parse(reply), { "x-lease-token": leaseToken });
  if (!response.ok) throw new Error(`RESULT_REJECTED_${response.status}`);
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
  try {
    const result = await executor.execute(job.toolName, job.arguments, approvedSummary);
    await submit(job.id, job.leaseToken, { kind: "completed", requestHash: job.requestHash, result });
  } catch (error) {
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
