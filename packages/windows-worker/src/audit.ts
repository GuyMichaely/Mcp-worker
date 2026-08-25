import { DatabaseSync } from "node:sqlite";
import type { PolicyDecision } from "./schema.js";

export type AuditRecord = {
  id: string;
  occurredAt: string;
  tool: string;
  capability: string;
  subject: string | null;
  decision: string;
  profile: string;
  ruleId: string | null;
  outcome: string;
  summary: string;
  durationMs: number;
  correlationId: string | null;
};

export class AuditStore {
  readonly database: DatabaseSync;

  constructor(databaseFile: string) {
    this.database = new DatabaseSync(databaseFile);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        tool TEXT NOT NULL,
        capability TEXT NOT NULL,
        subject TEXT,
        decision TEXT NOT NULL,
        profile TEXT NOT NULL,
        rule_id TEXT,
        outcome TEXT NOT NULL,
        summary TEXT NOT NULL,
        duration_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_events_occurred_at ON audit_events(occurred_at DESC);
      CREATE TABLE IF NOT EXISTS transfer_sessions (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL,
        local_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    const columns = this.database.prepare("PRAGMA table_info(audit_events)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "correlation_id")) {
      this.database.exec("ALTER TABLE audit_events ADD COLUMN correlation_id TEXT");
    }
    this.database.exec("CREATE INDEX IF NOT EXISTS audit_events_correlation ON audit_events(correlation_id)");
  }

  createTransfer(id: string, localPath: string, fileName: string, size: number, sha256: string, expiresAt: string): void {
    this.database.prepare(`
      INSERT INTO transfer_sessions (id, direction, local_path, file_name, size, sha256, status, created_at, expires_at)
      VALUES (?, 'export', ?, ?, ?, ?, 'ready', ?, ?)
    `).run(id, localPath, fileName, size, sha256, new Date().toISOString(), expiresAt);
  }

  getTransfer(id: string): { localPath: string; fileName: string; size: number; sha256: string; expiresAt: string } | undefined {
    const row = this.database.prepare(`
      SELECT local_path, file_name, size, sha256, expires_at FROM transfer_sessions WHERE id = ? AND status = 'ready'
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      localPath: String(row.local_path), fileName: String(row.file_name), size: Number(row.size),
      sha256: String(row.sha256), expiresAt: String(row.expires_at)
    };
  }

  record(id: string, decision: PolicyDecision, outcome: string, summary: string, durationMs: number, correlationId?: string): void {
    const subject = decision.request.subject ? JSON.stringify(decision.request.subject) : null;
    this.database.prepare(`
      INSERT INTO audit_events
        (id, occurred_at, tool, capability, subject, decision, profile, rule_id, outcome, summary, duration_ms, correlation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      new Date().toISOString(),
      decision.request.tool,
      decision.request.capability,
      subject,
      decision.decision,
      decision.profile,
      decision.ruleId,
      outcome,
      summary.slice(0, 2000),
      Math.max(0, Math.round(durationMs)),
      correlationId ?? null
    );
  }

  recent(limit = 100): AuditRecord[] {
    const rows = this.database.prepare(`
      SELECT id, occurred_at, tool, capability, subject, decision, profile, rule_id, outcome, summary, duration_ms, correlation_id
      FROM audit_events ORDER BY occurred_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(limit, 1000))) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      occurredAt: String(row.occurred_at),
      tool: String(row.tool),
      capability: String(row.capability),
      subject: row.subject === null ? null : String(row.subject),
      decision: String(row.decision),
      profile: String(row.profile),
      ruleId: row.rule_id === null ? null : String(row.rule_id),
      outcome: String(row.outcome),
      summary: String(row.summary),
      durationMs: Number(row.duration_ms),
      correlationId: row.correlation_id === null ? null : String(row.correlation_id)
    }));
  }

  close(): void {
    this.database.close();
  }
}
