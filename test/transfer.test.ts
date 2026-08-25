import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RelayStore } from "../src/remote/store.js";

describe("relay transfers", () => {
  const stores: RelayStore[] = [];
  const directories: string[] = [];
  afterEach(() => {
    stores.splice(0).forEach((store) => store.close());
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  it("assembles bounded chunks and verifies the final hash", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-transfer-"));
    directories.push(directory);
    const store = new RelayStore(":memory:", directory, 1024);
    stores.push(store);
    const bytes = Buffer.from("chunked transfer");
    const id = randomUUID();
    const common = {
      id, workerId: "w", fileName: "sample.txt", mimeType: "text/plain", size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), expiresAt: Date.now() + 60_000
    };
    expect(store.appendTransferChunk({ ...common, offset: 0, bytes: bytes.subarray(0, 7) }).state).toBe("uploading");
    expect(() => store.appendTransferChunk({ ...common, offset: 1, bytes: bytes.subarray(7) })).toThrow("TRANSFER_OFFSET_MISMATCH");
    expect(store.appendTransferChunk({ ...common, offset: 7, bytes: bytes.subarray(7) }).state).toBe("ready");
    expect(store.readTransfer(id)?.bytes).toEqual(bytes);
    expect(() => store.appendTransferChunk({ ...common, size: bytes.length + 1, offset: 0, bytes: Buffer.alloc(0) }))
      .toThrow("TRANSFER_METADATA_CONFLICT");
  });

  it("rejects oversized and expired transfers", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-transfer-"));
    directories.push(directory);
    const store = new RelayStore(":memory:", directory, 2);
    stores.push(store);
    const base = {
      id: randomUUID(), workerId: "w", fileName: "x", mimeType: "application/octet-stream",
      sha256: createHash("sha256").update("ab").digest("hex"), offset: 0, bytes: Buffer.from("ab")
    };
    expect(() => store.appendTransferChunk({ ...base, size: 3, bytes: Buffer.from("abc"), expiresAt: Date.now() + 1_000 })).toThrow("FILE_SIZE_LIMIT");
    expect(() => store.appendTransferChunk({ ...base, id: randomUUID(), size: 2, expiresAt: Date.now() - 1 })).toThrow("TRANSFER_EXPIRED");
  });

  it("removes expired transfer rows and files without deleting live transfers", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-transfer-"));
    directories.push(directory);
    const store = new RelayStore(":memory:", directory, 1024);
    stores.push(store);
    const now = Date.now();

    function add(id: string, text: string, expiresAt: number) {
      const bytes = Buffer.from(text);
      return store.appendTransferChunk({
        id,
        workerId: "w",
        fileName: `${id}.txt`,
        mimeType: "text/plain",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        expiresAt,
        offset: 0,
        bytes
      }, now);
    }

    const expiredId = randomUUID();
    const liveId = randomUUID();
    const expired = add(expiredId, "expired", now + 1_000);
    const live = add(liveId, "live", now + 60_000);
    expect(fs.existsSync(expired.localPath)).toBe(true);
    expect(fs.existsSync(live.localPath)).toBe(true);

    store.sweepTransfers(now + 2_000);

    expect(store.db.prepare("SELECT id FROM transfers WHERE id=?").get(expiredId)).toBeUndefined();
    expect(fs.existsSync(expired.localPath)).toBe(false);
    expect(store.getTransfer(liveId, false, now + 2_000)?.id).toBe(liveId);
    expect(fs.existsSync(live.localPath)).toBe(true);
  });
});
