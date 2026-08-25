import * as z from "zod/v4";
import { WorkerToolCatalog } from "./tool-catalog.js";

export const PROTOCOL_VERSION = "worker.v1" as const;

export const JobStateSchema = z.enum([
  "queued", "leased", "approval-pending", "completed", "failed", "expired", "cancelled", "indeterminate"
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const ToolSpecs = WorkerToolCatalog.map((tool) => ({
  ...tool,
  inputSchema: z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
  readOnly: tool.annotations?.readOnlyHint === true
}));

export type ToolName = string;
export function getToolSpec(name: string) { return ToolSpecs.find((tool) => tool.name === name); }

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
  approval: z.object({ ticket: z.string().min(32), accepted: z.literal(true) }).optional()
});
export type RelayJob = z.infer<typeof RelayJobSchema>;

export const WorkerReplySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("completed"), requestHash: z.string(), result: z.unknown() }),
  z.object({
    kind: z.literal("failed"), requestHash: z.string(),
    error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().default(false) })
  }),
  z.object({
    kind: z.literal("approval-required"), requestHash: z.string(), ticket: z.string().min(32),
    summary: z.string().min(1).max(2000), expiresAt: z.string()
  })
]);
export type WorkerReply = z.infer<typeof WorkerReplySchema>;
