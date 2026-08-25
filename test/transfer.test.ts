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
});
