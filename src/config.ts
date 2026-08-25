import { z } from "zod";

const Environment = z.object({
  BIND_HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:8787"),
  REMOTE_DB_PATH: z.string().default("./data/relay.sqlite"),
  REMOTE_TRANSFER_DIR: z.string().default("./data/transfers"),
  WORKER_ID: z.string().min(1).default("primary-windows"),
  WORKER_TOKEN_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
  WORKER_OFFLINE_AFTER_MS: z.coerce.number().int().positive().default(45_000),
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  MAX_JSON_BYTES: z.coerce.number().int().positive().default(1_048_576),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(268_435_456),
  TRANSFER_CHUNK_BYTES: z.coerce.number().int().min(65_536).max(8_388_608).default(1_048_576),
  OAUTH_ISSUER: z.string().url(),
  OAUTH_AUDIENCE: z.string().min(1),
  OAUTH_JWKS_URI: z.string().url(),
  OAUTH_REQUIRED_SCOPE: z.string().default("mcp:tools"),
  MCP_DEV_TOKEN_SHA256: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

export type AppConfig = z.infer<typeof Environment>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return Environment.parse(env);
}
