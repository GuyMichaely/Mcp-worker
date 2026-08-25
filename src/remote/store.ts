import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { JobState, RelayJob, WorkerReply } from "../shared/contracts.js";
import { PROTOCOL_VERSION } from "../shared/contracts.js";
import { canonicalJson } from "../shared/security.js";

export interface StoredJob {
  id: string;
  workerId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requestHash: string;
  state: JobState;
  readOnly: boolean;
  createdAt: number;
  expiresAt: number;
  attempt: number;
  leaseToken?: string;
  approvalTicket?: string;
  approvalExpiresAt?: number;
  approved: boolean;
  result?: unknown;
  error?: unknown;
  correlationId: string;
}

export interface StoredTransfer {
  id: string;
  workerId: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  expiresAt: number;
  receivedBytes: number;
  state: "uploading" | "ready";
  localPath: string;
}

type Row = {
  id: string; worker_id: string; tool_name: string; arguments_json: string; request_hash: string;
  state: JobState; read_only: number; created_at: number; expires_at: number; attempt: number;
  lease_token: string | null; lease_expires_at: number | null; approval_ticket: string | null;
  approval_expires_at: number | null; approved: number; result_json: string | null;
  error_json: string | null; correlation_id: string;
};

export class RelayStore {
  readonly db: DatabaseSync;
  private readonly transferDirectory: string;
  private readonly maxFileBytes: number;

  constructor(path: string, transferDirectory = join(dirname(path === ":memory:" ? "." : path), "transfers"), maxFileBytes = 268_435_456) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.transferDirectory = transferDirectory;
    this.maxFileBytes = maxFileBytes;
    mkdirSync(this.transferDirectory, { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workers (
        worker_id TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL,
        version TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
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
      CREATE INDEX IF NOT EXISTS jobs_worker_state ON jobs(worker_id, state, created_at);
      CREATE TABLE IF NOT EXISTS transfers (
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
      CREATE INDEX IF NOT EXISTS transfers_expiry ON transfers(state, expires_at);
    `);
    const appliedAt = Date.now();
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,?)").run(appliedAt);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,?)").run(appliedAt);
  }

  close(): void {
    this.db.close();
  }

  heartbeat(workerId: string, version: string, now = Date.now()): void {
    this.db.prepare(`
      INSERT INTO workers(worker_id,last_seen,version) VALUES(?,?,?)
      ON CONFLICT(worker_id) DO UPDATE SET last_seen=excluded.last_seen, version=excluded.version
    `).run(workerId, now, version);
  }

  isWorkerOnline(workerId: string, offlineAfterMs: number, now = Date.now()): boolean {
    const row = this.db.prepare("SELECT last_seen FROM workers WHERE worker_id=?").get(workerId) as { last_seen: number } | undefined;
    return Boolean(row && now - row.last_seen <= offlineAfterMs);
  }

  createJob(input: {
    workerId: string; toolName: string; arguments: Record<string, unknown>; requestHash: string;
    readOnly: boolean; expiresAt: number; correlationId?: string;
  }, now = Date.now()): StoredJob {
    const id = randomUUID();
    const correlationId = input.correlationId ?? randomUUID();
    this.db.prepare(`
      INSERT INTO jobs(id,worker_id,tool_name,arguments_json,request_hash,state,read_only,created_at,expires_at,correlation_id,updated_at)
      VALUES(?,?,?,?,?,'queued',?,?,?,?,?)
    `).run(id, input.workerId, input.toolName, canonicalJson(input.arguments), input.requestHash,
      input.readOnly ? 1 : 0, now, input.expiresAt, correlationId, now);
    return this.get(id)!;
  }

  get(id: string): StoredJob | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
    return row ? this.map(row) : undefined;
  }

  private map(row: Row): StoredJob {
    const value: StoredJob = {
      id: row.id,
      workerId: row.worker_id,
      toolName: row.tool_name,
      arguments: JSON.parse(row.arguments_json) as Record<string, unknown>,
      requestHash: row.request_hash,
      state: row.state,
      readOnly: Boolean(row.read_only),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      attempt: row.attempt,
      approved: Boolean(row.approved),
      correlationId: row.correlation_id
    };
    if (row.lease_token) value.leaseToken = row.lease_token;
    if (row.approval_ticket) value.approvalTicket = row.approval_ticket;
    if (row.approval_expires_at) value.approvalExpiresAt = row.approval_expires_at;
    if (row.result_json) value.result = JSON.parse(row.result_json);
    if (row.error_json) value.error = JSON.parse(row.error_json);
    return value;
  }

  sweep(now = Date.now()): void {
    this.db.prepare("UPDATE jobs SET state='expired',updated_at=? WHERE state IN ('queued','approval-pending') AND expires_at<=?")
      .run(now, now);
    this.db.prepare("UPDATE jobs SET state='expired',updated_at=? WHERE state='approval-pending' AND approval_expires_at<=?")
      .run(now, now);
    this.db.prepare("UPDATE jobs SET state='queued',lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE state='leased' AND lease_expires_at<=? AND read_only=1 AND expires_at>?")
      .run(now, now, now);
    this.db.prepare("UPDATE jobs SET state='indeterminate',lease_token=NULL,lease_expires_at=NULL,error_json=?,updated_at=? WHERE state='leased' AND lease_expires_at<=? AND read_only=0")
      .run(JSON.stringify({ code: "INDETERMINATE_EXECUTION", message: "The lease ended after a mutation may have started." }), now, now);
  }

  lease(workerId: string, leaseMs = 35_000, now = Date.now()): RelayJob | undefined {
    this.sweep(now);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT id FROM jobs WHERE worker_id=? AND state='queued' AND expires_at>? ORDER BY created_at LIMIT 1")
        .get(workerId, now) as { id: string } | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      const token = randomUUID() + randomUUID();
      this.db.prepare("UPDATE jobs SET state='leased',attempt=attempt+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=? AND state='queued'")
        .run(token, now + leaseMs, now, row.id);
      this.db.exec("COMMIT");
      const job = this.get(row.id)!;
      const relay: RelayJob = {
        protocolVersion: PROTOCOL_VERSION,
        id: job.id,
        workerId: job.workerId,
        toolName: job.toolName,
        arguments: job.arguments,
        requestHash: job.requestHash,
        createdAt: new Date(job.createdAt).toISOString(),
        expiresAt: new Date(job.expiresAt).toISOString(),
        attempt: job.attempt,
        leaseToken: job.leaseToken!,
        correlationId: job.correlationId
      };
      if (job.approved && job.approvalTicket) relay.approval = { ticket: job.approvalTicket, accepted: true };
      return relay;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  submitReply(id: string, leaseToken: string, reply: WorkerReply, now = Date.now()): StoredJob {
    const job = this.get(id);
    if (!job) throw new Error("JOB_NOT_FOUND");
    if (job.requestHash !== reply.requestHash) throw new Error("REQUEST_HASH_MISMATCH");
    if (["completed", "failed"].includes(job.state)) {
      const prior = job.state === "completed" ? job.result : job.error;
      const incoming = reply.kind === "completed" ? reply.result : reply.kind === "failed" ? reply.error : reply;
      if (canonicalJson(prior) !== canonicalJson(incoming)) throw new Error("RESULT_CONFLICT");
      return job;
    }
    if (job.state !== "leased" || job.leaseToken !== leaseToken) throw new Error("INVALID_LEASE");

    if (reply.kind === "approval-required") {
      if (Date.parse(reply.expiresAt) <= now || Date.parse(reply.expiresAt) > job.expiresAt) throw new Error("INVALID_APPROVAL_EXPIRY");
      this.db.prepare(`UPDATE jobs SET state='approval-pending',approval_ticket=?,approval_expires_at=?,error_json=?,
        lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?`)
        .run(reply.ticket, Date.parse(reply.expiresAt), canonicalJson({ summary: reply.summary }), now, id);
    } else if (reply.kind === "completed") {
      this.db.prepare("UPDATE jobs SET state='completed',result_json=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?")
        .run(canonicalJson(reply.result), now, id);
    } else {
      this.db.prepare("UPDATE jobs SET state='failed',error_json=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?")
        .run(canonicalJson(reply.error), now, id);
    }
    return this.get(id)!;
  }

  resumeApproval(ticket: string, requestHash: string, accepted: boolean, now = Date.now()): StoredJob {
    const row = this.db.prepare("SELECT id FROM jobs WHERE approval_ticket=?").get(ticket) as { id: string } | undefined;
    if (!row) throw new Error("APPROVAL_NOT_FOUND");
    const job = this.get(row.id)!;
    if (job.state !== "approval-pending" || job.requestHash !== requestHash || !job.approvalExpiresAt || job.approvalExpiresAt <= now) {
      throw new Error("INVALID_APPROVAL");
    }
    if (!accepted) {
      this.db.prepare("UPDATE jobs SET state='failed',error_json=?,updated_at=? WHERE id=?")
        .run(JSON.stringify({ code: "APPROVAL_DECLINED", message: "The user declined the exact action." }), now, job.id);
    } else {
      this.db.prepare("UPDATE jobs SET state='queued',approved=1,updated_at=? WHERE id=?").run(now, job.id);
    }
    return this.get(job.id)!;
  }

  cancel(id: string, now = Date.now()): StoredJob | undefined {
    this.db.prepare("UPDATE jobs SET state='cancelled',updated_at=? WHERE id=? AND state IN ('queued','approval-pending')").run(now, id);
    this.db.prepare("UPDATE jobs SET state='indeterminate',error_json=?,updated_at=? WHERE id=? AND state='leased' AND read_only=0")
      .run(JSON.stringify({ code: "CANCELLED_INDETERMINATE", message: "Cancellation arrived after a mutation may have started." }), now, id);
    return this.get(id);
  }

  appendTransferChunk(input: {
    id: string; workerId: string; fileName: string; mimeType: string; size: number;
    sha256: string; expiresAt: number; offset: number; bytes: Buffer;
  }, now = Date.now()): StoredTransfer {
    if (!/^[0-9a-f-]{36}$/i.test(input.id)) throw new Error("INVALID_TRANSFER_ID");
    if (input.size < 0 || input.size > this.maxFileBytes) throw new Error("FILE_SIZE_LIMIT");
    if (input.expiresAt <= now) throw new Error("TRANSFER_EXPIRED");
    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error("INVALID_TRANSFER_HASH");
    this.sweepTransfers(now);
    let transfer = this.getTransfer(input.id, true);
    if (transfer?.state === "ready") return transfer;
    if (!transfer) {
      if (input.offset !== 0) throw new Error("TRANSFER_OFFSET_MISMATCH");
      const localPath = join(this.transferDirectory, `${input.id}.part`);
      writeFileSync(localPath, Buffer.alloc(0), { flag: "wx" });
      this.db.prepare(`INSERT INTO transfers
        (id,worker_id,file_name,mime_type,size,sha256,expires_at,received_bytes,state,local_path,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,0,'uploading',?,?,?)`)
        .run(input.id, input.workerId, input.fileName.slice(0, 255), input.mimeType.slice(0, 255), input.size,
          input.sha256.toLowerCase(), input.expiresAt, localPath, now, now);
      transfer = this.getTransfer(input.id, true)!;
    }
    if (transfer.workerId !== input.workerId || transfer.size !== input.size || transfer.sha256 !== input.sha256.toLowerCase()) {
      throw new Error("TRANSFER_METADATA_CONFLICT");
    }
    if (transfer.receivedBytes !== input.offset) throw new Error("TRANSFER_OFFSET_MISMATCH");
    if (input.offset + input.bytes.length > input.size) throw new Error("TRANSFER_SIZE_MISMATCH");
    if (input.bytes.length) appendFileSync(transfer.localPath, input.bytes);
    const received = input.offset + input.bytes.length;
    this.db.prepare("UPDATE transfers SET received_bytes=?,updated_at=? WHERE id=?").run(received, now, input.id);
    if (received === input.size) {
      const actual = createHash("sha256").update(readFileSync(transfer.localPath)).digest("hex");
      if (actual !== transfer.sha256) throw new Error("TRANSFER_HASH_MISMATCH");
      const readyPath = join(this.transferDirectory, input.id);
      renameSync(transfer.localPath, readyPath);
      this.db.prepare("UPDATE transfers SET state='ready',local_path=?,updated_at=? WHERE id=?").run(readyPath, now, input.id);
    }
    return this.getTransfer(input.id, true)!;
  }

  getTransfer(id: string, includeUploading = false, now = Date.now()): StoredTransfer | undefined {
    const row = this.db.prepare("SELECT * FROM transfers WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!row || Number(row.expires_at) <= now || (!includeUploading && row.state !== "ready")) return undefined;
    const transfer: StoredTransfer = {
      id: String(row.id), workerId: String(row.worker_id), fileName: String(row.file_name), mimeType: String(row.mime_type),
      size: Number(row.size), sha256: String(row.sha256), expiresAt: Number(row.expires_at),
      receivedBytes: Number(row.received_bytes), state: String(row.state) as StoredTransfer["state"], localPath: String(row.local_path)
    };
    if (!existsSync(transfer.localPath) || statSync(transfer.localPath).size !== transfer.receivedBytes) throw new Error("TRANSFER_STORAGE_MISMATCH");
    return transfer;
  }

  readTransfer(id: string, now = Date.now()): { transfer: StoredTransfer; bytes: Buffer } | undefined {
    const transfer = this.getTransfer(id, false, now);
    return transfer ? { transfer, bytes: readFileSync(transfer.localPath) } : undefined;
  }

  sweepTransfers(now = Date.now()): void {
    const rows = this.db.prepare("SELECT id,local_path FROM transfers WHERE expires_at<=?").all(now) as Array<{ id: string; local_path: string }>;
    for (const row of rows) rmSync(row.local_path, { force: true });
    this.db.prepare("DELETE FROM transfers WHERE expires_at<=?").run(now);
  }
}
