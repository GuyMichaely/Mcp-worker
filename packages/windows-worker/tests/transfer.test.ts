import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { downloadResponseToFile } from "../src/transfer.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

function destination() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "worker-transfer-"));
  directories.push(directory);
  return path.join(directory, "download.bin");
}

describe("bounded transfer downloads", () => {
  it("writes a response within the configured limit", async () => {
    const file = destination();
    const bytes = Buffer.from("bounded download");
    await expect(downloadResponseToFile(new Response(bytes), file, bytes.length)).resolves.toBe(bytes.length);
    expect(fs.readFileSync(file)).toEqual(bytes);
  });

  it("rejects a declared content length above the configured limit before writing", async () => {
    const file = destination();
    const response = new Response("x", { headers: { "content-length": "1000" } });
    await expect(downloadResponseToFile(response, file, 10)).rejects.toThrow("FILE_SIZE_LIMIT");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("rejects an oversized streamed body and removes the partial file", async () => {
    const file = destination();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("12345"));
        controller.enqueue(Buffer.from("67890"));
        controller.close();
      }
    });
    await expect(downloadResponseToFile(new Response(stream), file, 6)).rejects.toThrow("FILE_SIZE_LIMIT");
    expect(fs.existsSync(file)).toBe(false);
  });
});
