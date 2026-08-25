import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RelayStore } from "../src/remote/store.js";
import { requestHash } from "../src/shared/security.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

function storePaths() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-restart-"));
  directories.push(directory);
  return {
    database: path.join(directory, "relay.sqlite"),
    transfers: path.join(directory, "transfers")
  };
}

describe("relay restart behavior", () => {
  it("recovers an expired read-only lease after reopening the database", () => {
    const paths = storePaths();
    const hash = requestHash("machine_status", {});
    let store = new RelayStore(paths.database, paths.transfers);
    const created = store.createJob({
      workerId: "w",
      toolName: "machine_status",
      arguments: {},
      requestHash: hash,
      readOnly: true,
      expiresAt: 10_000
    }, 1_000);
    const firstLease = store.lease("w", 100, 1_001)!;
    expect(firstLease.id).toBe(created.id);
    expect(firstLease.attempt).toBe(1);
    store.close();

    store = new RelayStore(paths.database, paths.transfers);
    try {
      expect(store.get(created.id)?.state).toBe("leased");
      store.sweep(1_102);
      const recovered = store.lease("w", 100, 1_103)!;
      expect(recovered.id).toBe(created.id);
      expect(recovered.attempt).toBe(2);
      expect(recovered.leaseToken).not.toBe(firstLease.leaseToken);
    } finally {
      store.close();
    }
  });

  it("marks an expired mutation lease indeterminate after reopening the database", () => {
    const paths = storePaths();
    const args = { path: "C:\\workspace\\a.txt", text: "x", create_parent: false };
    const hash = requestHash("fs_write", args);
    let store = new RelayStore(paths.database, paths.transfers);
    const created = store.createJob({
      workerId: "w",
      toolName: "fs_write",
      arguments: args,
      requestHash: hash,
      readOnly: false,
      expiresAt: 10_000
    }, 1_000);
    store.lease("w", 100, 1_001);
    store.close();

    store = new RelayStore(paths.database, paths.transfers);
    try {
      store.sweep(1_102);
      const recovered = store.get(created.id);
      expect(recovered?.state).toBe("indeterminate");
      expect(recovered?.leaseToken).toBeUndefined();
      expect(recovered?.error).toMatchObject({ code: "INDETERMINATE_EXECUTION" });
      expect(store.lease("w", 100, 1_103)).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("preserves a pending exact-action approval across a relay restart", () => {
    const paths = storePaths();
    const args = { path: "C:\\workspace\\a.txt", text: "x", create_parent: false };
    const hash = requestHash("fs_write", args);
    const ticket = "r".repeat(64);
    let store = new RelayStore(paths.database, paths.transfers);
    const created = store.createJob({
      workerId: "w",
      toolName: "fs_write",
      arguments: args,
      requestHash: hash,
      readOnly: false,
      expiresAt: 20_000
    }, 1_000);
    const leased = store.lease("w", 1_000, 1_001)!;
    store.submitReply(leased.id, leased.leaseToken, {
      kind: "approval-required",
      requestHash: hash,
      ticket,
      summary: "Write a.txt?",
      expiresAt: new Date(10_000).toISOString()
    }, 1_002);
    store.close();

    store = new RelayStore(paths.database, paths.transfers);
    try {
      const pending = store.get(created.id);
      expect(pending?.state).toBe("approval-pending");
      expect(pending?.approvalTicket).toBe(ticket);
      expect(() => store.resumeApproval(ticket, "f".repeat(64), true, 1_003)).toThrow("INVALID_APPROVAL");
      expect(store.resumeApproval(ticket, hash, true, 1_003).state).toBe("queued");
      const resumed = store.lease("w", 1_000, 1_004)!;
      expect(resumed.id).toBe(created.id);
      expect(resumed.approval?.ticket).toBe(ticket);
    } finally {
      store.close();
    }
  });
});
