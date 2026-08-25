import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelayStore } from "../src/remote/store.js";
import { requestHash } from "../src/shared/security.js";

describe("relay store", () => {
  let store: RelayStore;
  beforeEach(() => { store = new RelayStore(":memory:"); });
  afterEach(() => store.close());

  it("leases and deduplicates an identical result", () => {
    const hash = requestHash("machine_status", {});
    const created = store.createJob({
      workerId: "w", toolName: "machine_status", arguments: {}, requestHash: hash,
      readOnly: true, expiresAt: 10_000
    }, 1_000);
    const lease = store.lease("w", 1_000, 1_001)!;
    expect(lease.id).toBe(created.id);
    const reply = { kind: "completed" as const, requestHash: hash, result: { ok: true } };
    expect(store.submitReply(lease.id, lease.leaseToken, reply, 1_002).state).toBe("completed");
    expect(store.submitReply(lease.id, lease.leaseToken, reply, 1_003).state).toBe("completed");
  });

  it("rejects a result bound to another request", () => {
    const hash = requestHash("machine_status", {});
    store.createJob({
      workerId: "w", toolName: "machine_status", arguments: {}, requestHash: hash,
      readOnly: true, expiresAt: 10_000
    }, 1_000);
    const lease = store.lease("w", 1_000, 1_001)!;
    expect(() => store.submitReply(lease.id, lease.leaseToken, {
      kind: "completed", requestHash: "0".repeat(64), result: {}
    }, 1_002)).toThrow("REQUEST_HASH_MISMATCH");
  });

  it("requeues expired read leases and marks mutations indeterminate", () => {
    const readHash = requestHash("file_read", { path: "a" });
    store.createJob({
      workerId: "w", toolName: "file_read", arguments: { path: "a" }, requestHash: readHash,
      readOnly: true, expiresAt: 10_000
    }, 1_000);
    store.lease("w", 100, 1_001);
    store.sweep(1_102);
    const retriedRead = store.lease("w", 100, 1_103)!;
    expect(retriedRead.attempt).toBe(2);
    store.submitReply(retriedRead.id, retriedRead.leaseToken, {
      kind: "completed", requestHash: retriedRead.requestHash, result: { content: "a" }
    }, 1_104);

    const writeHash = requestHash("file_write", { path: "a", content: "x" });
    const write = store.createJob({
      workerId: "w", toolName: "file_write", arguments: { path: "a", content: "x" }, requestHash: writeHash,
      readOnly: false, expiresAt: 10_000
    }, 2_000);
    store.lease("w", 100, 2_001);
    store.sweep(2_102);
    expect(store.get(write.id)?.state).toBe("indeterminate");
  });

  it("binds approval to the ticket, request hash, and expiry", () => {
    const hash = requestHash("file_write", { path: "a", content: "x" });
    store.createJob({
      workerId: "w", toolName: "file_write", arguments: { path: "a", content: "x" }, requestHash: hash,
      readOnly: false, expiresAt: 20_000
    }, 1_000);
    const lease = store.lease("w", 1_000, 1_001)!;
    const ticket = "t".repeat(64);
    store.submitReply(lease.id, lease.leaseToken, {
      kind: "approval-required", requestHash: hash, ticket, summary: "Write a?", expiresAt: new Date(10_000).toISOString()
    }, 1_002);
    expect(() => store.resumeApproval(ticket, "f".repeat(64), true, 1_003)).toThrow("INVALID_APPROVAL");
    expect(store.resumeApproval(ticket, hash, true, 1_003).state).toBe("queued");
    expect(store.lease("w", 1_000, 1_004)?.approval?.ticket).toBe(ticket);
  });
});
