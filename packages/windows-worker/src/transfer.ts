import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

function sizeLimitError(maxBytes: number): Error {
  return new Error(`FILE_SIZE_LIMIT: download exceeds ${maxBytes} bytes.`);
}

export async function downloadResponseToFile(response: Response, destination: string, maxBytes: number): Promise<number> {
  if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}.`);

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw sizeLimitError(maxBytes);
  }

  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) callback(sizeLimitError(maxBytes));
      else callback(null, chunk);
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      limiter,
      fs.createWriteStream(destination, { flags: "wx" })
    );
    return bytes;
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  }
}
