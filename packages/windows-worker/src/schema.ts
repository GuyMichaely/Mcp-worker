import { z } from "zod";

export const DecisionSchema = z.enum(["allow", "prompt", "deny"]);
export type Decision = z.infer<typeof DecisionSchema>;

export const CapabilitySchema = z.enum([
  "machine.status",
  "policy.inspect",
  "fs.read",
  "fs.create",
  "fs.write",
  "fs.delete",
  "process.execute.sandboxed",
  "process.execute.unsandboxed",
  "process.network",
  "desktop.observe",
  "desktop.control",
  "clipboard.read",
  "clipboard.write",
  "transfer.import",
  "transfer.export"
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const SubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("path"), value: z.string().min(1) }),
  z.object({ kind: z.literal("executable"), value: z.string().min(1) }),
  z.object({ kind: z.literal("app"), value: z.string().min(1) }),
  z.object({ kind: z.literal("special"), value: z.string().min(1) })
]);
export type Subject = z.infer<typeof SubjectSchema>;

export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().default(""),
  tools: z.array(z.string().min(1)).optional(),
  subjects: z.array(SubjectSchema).optional(),
  capabilities: z.array(CapabilitySchema).min(1),
  decision: DecisionSchema
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const ProfileSchema = z.object({
  description: z.string(),
  defaultDecision: DecisionSchema,
  processMode: z.enum(["strict", "policy-only"]),
  rules: z.array(PolicyRuleSchema)
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ConfigSchema = z.object({
  version: z.literal(1),
  activeProfile: z.string().min(1),
  service: z.object({
    host: z.literal("127.0.0.1").default("127.0.0.1"),
    port: z.number().int().min(1024).max(65535).default(47320),
    requireBearerToken: z.boolean().default(false)
  }),
  admin: z.object({
    enabled: z.boolean().default(true),
    host: z.literal("127.0.0.1").default("127.0.0.1"),
    port: z.number().int().min(1024).max(65535).default(47321)
  }),
  paths: z.object({
    workspace: z.string().min(1),
    nativeHelper: z.string().optional()
  }),
  limits: z.object({
    maxReadBytes: z.number().int().positive().default(1_048_576),
    maxProcessOutputBytes: z.number().int().positive().default(268_435_456),
    maxTransferBytes: z.number().int().positive().default(268_435_456),
    defaultProcessTimeoutMs: z.number().int().positive().default(300_000),
    transferChunkBytes: z.number().int().min(65_536).max(8_388_608).default(1_048_576)
  }),
  profiles: z.record(z.string(), ProfileSchema)
}).superRefine((config, context) => {
  if (!(config.activeProfile in config.profiles)) {
    context.addIssue({
      code: "custom",
      path: ["activeProfile"],
      message: `Unknown profile: ${config.activeProfile}`
    });
  }
});
export type AppConfig = z.infer<typeof ConfigSchema>;

export const ToolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional()
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

export type PolicyRequest = {
  tool: string;
  capability: Capability;
  subject?: Subject;
};

export type PolicyDecision = {
  decision: Decision;
  profile: string;
  ruleId: string | null;
  request: PolicyRequest;
};
