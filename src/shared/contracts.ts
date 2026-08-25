import * as z from "zod/v4";

export const PROTOCOL_VERSION = "worker.v1" as const;

export const JobStateSchema = z.enum([
  "queued",
  "leased",
  "approval-pending",
  "completed",
  "failed",
  "expired",
  "cancelled",
  "indeterminate"
]);
export type JobState = z.infer<typeof JobStateSchema>;

const relativePath = z.string().min(1).max(2048);
const args = z.array(z.string().max(16_384)).max(128);

export const ToolSpecs = [
  {
    name: "machine_status",
    title: "Get machine status",
    description: "Report worker availability, operating system, uptime, memory, and the authorized workspace.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    readOnly: true
  },
  {
    name: "file_read",
    title: "Read a workspace file",
    description: "Read one UTF-8 file inside the policy-authorized workspace.",
    inputSchema: z.object({ path: relativePath }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    readOnly: true
  },
  {
    name: "file_write",
    title: "Write a workspace file",
    description: "Create or replace one UTF-8 file inside the policy-authorized workspace.",
    inputSchema: z.object({
      path: relativePath,
      content: z.string().max(1_048_576),
      createParents: z.boolean().default(false)
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
    readOnly: false
  },
  {
    name: "process_run",
    title: "Run a process",
    description: "Run one executable without a shell, inside the authorized workspace, with bounded output and runtime.",
    inputSchema: z.object({
      executable: z.string().min(1).max(2048),
      args: args.default([]),
      cwd: relativePath.optional(),
      timeoutMs: z.number().int().min(100).max(300_000).default(30_000)
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    readOnly: false
  }
] as const;

export type ToolName = (typeof ToolSpecs)[number]["name"];

export function getToolSpec(name: string) {
  return ToolSpecs.find((tool) => tool.name === name);
}

export const RelayJobSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: z.uuid(),
  workerId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string(),
  expiresAt: z.string(),
  attempt: z.number().int().positive(),
  leaseToken: z.string().min(32),
  correlationId: z.string().min(1),
  approval: z.object({
    ticket: z.string().min(32),
    accepted: z.literal(true)
  }).optional()
});
export type RelayJob = z.infer<typeof RelayJobSchema>;

export const WorkerReplySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("completed"),
    requestHash: z.string(),
    result: z.unknown()
  }),
  z.object({
    kind: z.literal("failed"),
    requestHash: z.string(),
    error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().default(false) })
  }),
  z.object({
    kind: z.literal("approval-required"),
    requestHash: z.string(),
    ticket: z.string().min(32),
    summary: z.string().min(1).max(2000),
    expiresAt: z.string()
  })
]);
export type WorkerReply = z.infer<typeof WorkerReplySchema>;
