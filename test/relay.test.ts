import { afterEach, describe, expect, it } from "vitest";
import { RelayService } from "../src/remote/relay.js";
import { RelayStore } from "../src/remote/store.js";

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("relay service", () => {
  const stores: RelayStore[] = [];
  afterEach(() => stores.splice(0).forEach((store) => store.close()));

  it("returns WORKER_OFFLINE before creating work", async () => {
    const store = new RelayStore(":memory:");
    stores.push(store);
    const relay = new RelayService(store, "w", 1_000, 5_000);
    await expect(relay.call("machine_status", {}, async () => false)).rejects.toMatchObject({ code: "WORKER_OFFLINE" });
  });

  it("round-trips a read-only result", async () => {
    const store = new RelayStore(":memory:");
    stores.push(store);
    store.heartbeat("w", "test");
    const relay = new RelayService(store, "w", 5_000, 5_000);
    const call = relay.call("machine_status", {}, async () => false);
    let job;
    while (!(job = store.lease("w"))) await pause();
    store.submitReply(job.id, job.leaseToken, {
      kind: "completed", requestHash: job.requestHash, result: { online: true }
    });
    await expect(call).resolves.toEqual({ online: true });
  });

  it("resumes only after accepted elicitation", async () => {
    const store = new RelayStore(":memory:");
    stores.push(store);
    store.heartbeat("w", "test");
    const relay = new RelayService(store, "w", 5_000, 5_000);
    let prompted = false;
    const call = relay.call("fs_write", { path: "C:\\workspace\\a.txt", text: "x", create_parent: false }, async () => {
      prompted = true;
      return true;
    });
    let first;
    while (!(first = store.lease("w"))) await pause();
    const ticket = "a".repeat(64);
    store.submitReply(first.id, first.leaseToken, {
      kind: "approval-required",
      requestHash: first.requestHash,
      ticket,
      summary: "Write a.txt?",
      expiresAt: new Date(Date.now() + 2_000).toISOString()
    });
    let resumed;
    while (!(resumed = store.lease("w"))) await pause();
    expect(prompted).toBe(true);
    expect(resumed.approval?.ticket).toBe(ticket);
    store.submitReply(resumed.id, resumed.leaseToken, {
      kind: "completed", requestHash: resumed.requestHash, result: { bytesWritten: 1 }
    });
    await expect(call).resolves.toEqual({ bytesWritten: 1 });
  });

  it("rejects a resumed approval when the action arguments changed", async () => {
    const store = new RelayStore(":memory:");
    stores.push(store);
    store.heartbeat("w", "test");
    const relay = new RelayService(store, "w", 5_000, 5_000);
    const original = { path: "C:\\workspace\\a.txt", text: "x", create_parent: false };
    const begin = relay.beginCall("fs_write", original);
    let job;
    while (!(job = store.lease("w"))) await pause();
    const ticket = "c".repeat(64);
    store.submitReply(job.id, job.leaseToken, {
      kind: "approval-required",
      requestHash: job.requestHash,
      ticket,
      summary: "Write a.txt?",
      expiresAt: new Date(Date.now() + 2_000).toISOString()
    });
    const step = await begin;
    expect(step.kind).toBe("approval-required");
    if (step.kind !== "approval-required") throw new Error("Expected approval-required");
    await expect(relay.resumeCall("fs_write", { ...original, text: "changed" }, step.prompt, true)).rejects.toMatchObject({
      code: "APPROVAL_MISMATCH"
    });
    expect(store.get(job.id)?.state).toBe("approval-pending");
  });
});
