import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Runtime } from "./runtime.js";
import { canonicalizeExistingPath, canonicalizeProspectivePath } from "./path-policy.js";
import { asMcpResult } from "./mcp-result.js";
import { downloadResponseToFile } from "./transfer.js";

const PathSchema = z.string().min(1).describe("An absolute Windows path.");

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function pathSubject(value: string) {
  return { kind: "path" as const, value };
}

function directoryEntries(directory: string) {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(directory, entry.name);
    const stat = fs.statSync(fullPath);
    return {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      size: stat.size,
      modified_at: stat.mtime.toISOString()
    };
  });
}

function isProbablyText(buffer: Buffer): boolean {
  return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

export function registerFileTools(server: McpServer, runtime: Runtime): void {
  server.registerTool("fs_list", {
    title: "List files",
    description: "List the direct children of an allowed directory on the Windows machine.",
    inputSchema: { path: PathSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ path: input }) => {
    const canonical = canonicalizeExistingPath(input);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_list", capability: "fs.read", subject: pathSubject(canonical)
    }, `List directory ${input}`, async () => ({ path: input, entries: directoryEntries(input) })));
  });

  server.registerTool("fs_stat", {
    title: "Inspect file",
    description: "Return metadata and a SHA-256 hash for an allowed file or directory.",
    inputSchema: { path: PathSchema, include_hash: z.boolean().default(true) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ path: input, include_hash }) => {
    const canonical = canonicalizeExistingPath(input);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_stat", capability: "fs.read", subject: pathSubject(canonical)
    }, `Inspect ${input}`, async () => {
      const stat = fs.statSync(input);
      return {
        path: input,
        type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
        size: stat.size,
        created_at: stat.birthtime.toISOString(),
        modified_at: stat.mtime.toISOString(),
        sha256: include_hash && stat.isFile() ? await hashFile(input) : null
      };
    }));
  });

  server.registerTool("fs_read", {
    title: "Read text file",
    description: "Read a bounded UTF-8 range from an allowed text file. Use file_export for binary or large files.",
    inputSchema: {
      path: PathSchema,
      offset: z.number().int().min(0).default(0),
      max_bytes: z.number().int().positive().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ path: input, offset, max_bytes }) => {
    const canonical = canonicalizeExistingPath(input);
    const limit = Math.min(max_bytes ?? runtime.config.limits.maxReadBytes, runtime.config.limits.maxReadBytes);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_read", capability: "fs.read", subject: pathSubject(canonical)
    }, `Read ${limit} bytes from ${input} at offset ${offset}`, async () => {
      const handle = fs.openSync(input, "r");
      try {
        const stat = fs.fstatSync(handle);
        const bytes = Math.max(0, Math.min(limit, stat.size - offset));
        const buffer = Buffer.alloc(bytes);
        const read = fs.readSync(handle, buffer, 0, bytes, offset);
        return {
          path: input,
          offset,
          bytes_read: read,
          total_bytes: stat.size,
          eof: offset + read >= stat.size,
          text: buffer.subarray(0, read).toString("utf8"),
          sha256: await hashFile(input)
        };
      } finally {
        fs.closeSync(handle);
      }
    }));
  });

  server.registerTool("fs_search", {
    title: "Search files",
    description: "Recursively search file names and bounded text content under an allowed directory. Symbolic links are not followed.",
    inputSchema: {
      path: PathSchema,
      query: z.string().min(1),
      regex: z.boolean().default(false),
      include_content: z.boolean().default(true),
      max_results: z.number().int().min(1).max(1000).default(200)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ path: input, query, regex, include_content, max_results }) => {
    const canonical = canonicalizeExistingPath(input);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_search", capability: "fs.read", subject: pathSubject(canonical)
    }, `Search ${input} for ${query}`, async () => {
      const matcher = regex ? new RegExp(query, "giu") : undefined;
      const results: Array<{ path: string; kind: "name" | "content"; line?: number; text?: string }> = [];
      const pending = [input];
      let filesScanned = 0;
      while (pending.length > 0 && results.length < max_results && filesScanned < 10_000) {
        const current = pending.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          if (results.length >= max_results) break;
          const full = path.join(current, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.name.toLocaleLowerCase("en-US").includes(query.toLocaleLowerCase("en-US")) || (matcher && (matcher.lastIndex = 0, matcher.test(entry.name)))) {
            results.push({ path: full, kind: "name" });
          }
          if (entry.isDirectory()) pending.push(full);
          else if (entry.isFile() && include_content && results.length < max_results) {
            filesScanned++;
            const handle = fs.openSync(full, "r");
            try {
              const size = Math.min(fs.fstatSync(handle).size, runtime.config.limits.maxReadBytes);
              const buffer = Buffer.alloc(size);
              const count = fs.readSync(handle, buffer, 0, size, 0);
              if (!isProbablyText(buffer.subarray(0, count))) continue;
              const lines = buffer.subarray(0, count).toString("utf8").split(/\r?\n/);
              for (let index = 0; index < lines.length && results.length < max_results; index++) {
                const line = lines[index] ?? "";
                const matches = matcher ? (matcher.lastIndex = 0, matcher.test(line)) : line.toLocaleLowerCase("en-US").includes(query.toLocaleLowerCase("en-US"));
                if (matches) results.push({ path: full, kind: "content", line: index + 1, text: line.slice(0, 2000) });
              }
            } finally { fs.closeSync(handle); }
          }
        }
      }
      return { root: input, query, results, files_scanned: filesScanned, truncated: results.length >= max_results || filesScanned >= 10_000 };
    }));
  });

  server.registerTool("fs_write", {
    title: "Write text file",
    description: "Create or atomically replace an allowed UTF-8 text file. expected_sha256 prevents overwriting a changed file.",
    inputSchema: {
      path: PathSchema,
      text: z.string(),
      expected_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
      create_parent: z.boolean().default(false)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  }, async ({ path: input, text, expected_sha256, create_parent }) => {
    const exists = fs.existsSync(input);
    const canonical = exists ? canonicalizeExistingPath(input) : canonicalizeProspectivePath(input);
    const capability = exists ? "fs.write" as const : "fs.create" as const;
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_write", capability, subject: pathSubject(canonical)
    }, `${exists ? "Replace" : "Create"} text file ${input}`, async () => {
      if (expected_sha256) {
        if (!exists) throw new Error("expected_sha256 was supplied but the file does not exist.");
        const actual = await hashFile(input);
        if (actual.toLowerCase() !== expected_sha256.toLowerCase()) {
          throw new Error(`File changed. Expected ${expected_sha256}, found ${actual}.`);
        }
      }
      const parent = path.dirname(input);
      if (create_parent) fs.mkdirSync(parent, { recursive: true });
      const temporary = path.join(parent, `.${path.basename(input)}.${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, input);
      return { path: input, bytes_written: Buffer.byteLength(text), sha256: await hashFile(input) };
    }));
  });

  server.registerTool("fs_replace", {
    title: "Replace exact text",
    description: "Apply ordered exact-text replacements to an allowed UTF-8 file, with optional SHA-256 concurrency protection.",
    inputSchema: {
      path: PathSchema,
      replacements: z.array(z.object({ old_text: z.string().min(1), new_text: z.string(), replace_all: z.boolean().default(false) })).min(1).max(100),
      expected_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ path: input, replacements, expected_sha256 }) => {
    const canonical = canonicalizeExistingPath(input);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_replace", capability: "fs.write", subject: pathSubject(canonical)
    }, `Apply ${replacements.length} exact-text replacements to ${input}`, async () => {
      const originalHash = await hashFile(input);
      if (expected_sha256 && originalHash.toLowerCase() !== expected_sha256.toLowerCase()) throw new Error(`File changed. Expected ${expected_sha256}, found ${originalHash}.`);
      let text = fs.readFileSync(input, "utf8");
      const counts: number[] = [];
      for (const replacement of replacements) {
        const occurrences = text.split(replacement.old_text).length - 1;
        if (occurrences === 0) throw new Error("An old_text value was not found; no changes were written.");
        if (!replacement.replace_all && occurrences !== 1) throw new Error(`An old_text value matched ${occurrences} times; set replace_all=true or provide more context.`);
        text = replacement.replace_all ? text.split(replacement.old_text).join(replacement.new_text) : text.replace(replacement.old_text, replacement.new_text);
        counts.push(replacement.replace_all ? occurrences : 1);
      }
      const temporary = `${input}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, input);
      return { path: input, replacements: counts, sha256: await hashFile(input) };
    }));
  });

  server.registerTool("fs_mkdir", {
    title: "Create directory",
    description: "Create an allowed directory, including missing parents when requested.",
    inputSchema: { path: PathSchema, recursive: z.boolean().default(true) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  }, async ({ path: input, recursive }) => {
    const canonical = canonicalizeProspectivePath(input);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_mkdir", capability: "fs.create", subject: pathSubject(canonical)
    }, `Create directory ${input}`, async () => {
      fs.mkdirSync(input, { recursive });
      return { path: input };
    }));
  });

  server.registerTool("fs_copy", {
    title: "Copy file or directory",
    description: "Copy an allowed file or directory to an allowed destination.",
    inputSchema: { source: PathSchema, destination: PathSchema, overwrite: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ source, destination, overwrite }) => {
    const sourceCanonical = canonicalizeExistingPath(source);
    const destinationCanonical = fs.existsSync(destination)
      ? canonicalizeExistingPath(destination)
      : canonicalizeProspectivePath(destination);
    const readDecision = await runtime.authorized(server, {
      tool: "fs_copy", capability: "fs.read", subject: pathSubject(sourceCanonical)
    }, `Read copy source ${source}`, async () => true);
    if (!readDecision.ok) return asMcpResult(readDecision);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_copy", capability: fs.existsSync(destination) ? "fs.write" : "fs.create", subject: pathSubject(destinationCanonical)
    }, `Copy ${source} to ${destination}`, async () => {
      fs.cpSync(source, destination, { recursive: true, force: overwrite, errorOnExist: !overwrite });
      return { source, destination };
    }));
  });

  server.registerTool("fs_move", {
    title: "Move file or directory",
    description: "Move an allowed file or directory to an allowed destination.",
    inputSchema: { source: PathSchema, destination: PathSchema, overwrite: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ source, destination, overwrite }) => {
    const sourceCanonical = canonicalizeExistingPath(source);
    const destinationCanonical = fs.existsSync(destination)
      ? canonicalizeExistingPath(destination)
      : canonicalizeProspectivePath(destination);
    const sourceDecision = await runtime.authorized(server, {
      tool: "fs_move", capability: "fs.delete", subject: pathSubject(sourceCanonical)
    }, `Remove move source ${source}`, async () => true);
    if (!sourceDecision.ok) return asMcpResult(sourceDecision);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_move", capability: fs.existsSync(destination) ? "fs.write" : "fs.create", subject: pathSubject(destinationCanonical)
    }, `Move ${source} to ${destination}`, async () => {
      if (fs.existsSync(destination)) {
        if (!overwrite) throw new Error("Destination exists and overwrite is false.");
        fs.rmSync(destination, { recursive: true, force: true });
      }
      fs.renameSync(source, destination);
      return { source, destination };
    }));
  });

  server.registerTool("fs_delete", {
    title: "Delete file or directory",
    description: "Move an allowed file or directory into the server's recoverable trash. Permanent deletion requires permanent=true.",
    inputSchema: { path: PathSchema, permanent: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ path: input, permanent }) => {
    const canonical = canonicalizeExistingPath(input);
    return asMcpResult(await runtime.authorized(server, {
      tool: "fs_delete", capability: "fs.delete", subject: pathSubject(canonical)
    }, `${permanent ? "Permanently delete" : "Move to recoverable trash"} ${input}`, async () => {
      if (permanent) {
        fs.rmSync(input, { recursive: true, force: false });
        return { path: input, permanent: true };
      }
      const trashId = crypto.randomUUID();
      const trashPath = path.join(runtime.paths.trashDirectory, trashId);
      fs.renameSync(input, trashPath);
      fs.writeFileSync(`${trashPath}.json`, JSON.stringify({ original_path: input, deleted_at: new Date().toISOString() }, null, 2));
      return { path: input, permanent: false, trash_id: trashId };
    }));
  });

  const FileParam = z.object({
    download_url: z.string().url(),
    file_id: z.string().min(1),
    mime_type: z.string().optional(),
    file_name: z.string().optional()
  });
  server.registerTool("file_import", {
    title: "Import ChatGPT file",
    description: "Stream a ChatGPT-authorized file into an allowed local destination without exposing its bytes to the model.",
    inputSchema: { file: FileParam, destination: PathSchema, expected_sha256: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { "openai/fileParams": ["file"] }
  }, async ({ file, destination, expected_sha256 }) => {
    const canonical = fs.existsSync(destination)
      ? canonicalizeExistingPath(destination)
      : canonicalizeProspectivePath(destination);
    return asMcpResult(await runtime.authorized(server, {
      tool: "file_import", capability: "transfer.import", subject: pathSubject(canonical)
    }, `Import ChatGPT file ${file.file_name ?? file.file_id} to ${destination}`, async () => {
      const response = await fetch(file.download_url, { redirect: "follow" });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      const bytes = await downloadResponseToFile(response, temporary, runtime.config.limits.maxTransferBytes);
      const sha256 = await hashFile(temporary);
      if (expected_sha256 && sha256.toLowerCase() !== expected_sha256.toLowerCase()) {
        fs.rmSync(temporary, { force: true });
        throw new Error(`SHA-256 mismatch. Expected ${expected_sha256}, found ${sha256}.`);
      }
      fs.renameSync(temporary, destination);
      return { destination, file_id: file.file_id, bytes, sha256 };
    }));
  });

  server.registerTool("file_export", {
    title: "Export local file",
    description: "Expose an allowed local file to ChatGPT through a short-lived signed download without putting file bytes in model context.",
    inputSchema: { path: PathSchema, expires_minutes: z.number().int().min(1).max(1440).default(30) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  }, async ({ path: input, expires_minutes }) => {
    const canonical = canonicalizeExistingPath(input);
    const result = await runtime.authorized(server, {
      tool: "file_export", capability: "transfer.export", subject: pathSubject(canonical)
    }, `Export ${input} to this ChatGPT conversation for ${expires_minutes} minutes`, async () => {
      const stat = fs.statSync(input);
      if (!stat.isFile()) throw new Error("file_export accepts a file, not a directory.");
      const id = crypto.randomUUID();
      const fileName = path.basename(input);
      const stored = path.join(runtime.paths.transferDirectory, id);
      fs.copyFileSync(input, stored);
      const sha256 = await hashFile(stored);
      const expires = Date.now() + expires_minutes * 60_000;
      const expiresAt = new Date(expires).toISOString();
      runtime.audit.createTransfer(id, stored, fileName, stat.size, sha256, expiresAt);
      return { id, file_name: fileName, size: stat.size, sha256, expires_at: expiresAt, uri: `machine-file://transfer/${id}/${encodeURIComponent(fileName)}` };
    });
    if (!result.ok || !result.data) return asMcpResult(result);
    return {
      content: [
        { type: "resource_link" as const, uri: result.data.uri, name: result.data.file_name, title: result.data.file_name, mimeType: "application/octet-stream", size: result.data.size },
        { type: "text" as const, text: `Exported ${result.data.file_name}; the signed link expires at ${result.data.expires_at}. Audit ID: ${result.audit_id}` }
      ]
    };
  });
}
