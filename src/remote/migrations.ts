import { DatabaseSync } from "node:sqlite";

export interface RelayMigration {
  version: number;
  sql: string;
}

export const RELAY_MIGRATIONS: readonly RelayMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE workers (
        worker_id TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL,
        version TEXT NOT NULL
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        read_only INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT,
        lease_expires_at INTEGER,
        approval_ticket TEXT UNIQUE,
        approval_expires_at INTEGER,
        approved INTEGER NOT NULL DEFAULT 0,
        result_json TEXT,
        error_json TEXT,
        correlation_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX jobs_worker_state ON jobs(worker_id, state, created_at);
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE transfers (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        received_bytes INTEGER NOT NULL,
        state TEXT NOT NULL,
        local_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX transfers_expiry ON transfers(state, expires_at);
    `
  }
];

export function migrateRelayDatabase(db: DatabaseSync, now = Date.now()): void {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
  const applied = rows.map((row) => Number(row.version));
  const latestSupported = RELAY_MIGRATIONS.at(-1)?.version ?? 0;
  const newestApplied = applied.at(-1) ?? 0;
  if (newestApplied > latestSupported) {
    throw new Error(`DB_SCHEMA_TOO_NEW: database=${newestApplied} supported=${latestSupported}`);
  }
  for (let index = 0; index < applied.length; index += 1) {
    if (applied[index] !== index + 1) {
      throw new Error(`DB_SCHEMA_MIGRATION_GAP: expected=${index + 1} found=${applied[index]}`);
    }
  }

  const appliedSet = new Set(applied);
  for (const migration of RELAY_MIGRATIONS) {
    if (appliedSet.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(migration.version, now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
