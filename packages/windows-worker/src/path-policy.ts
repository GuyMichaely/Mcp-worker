import fs from "node:fs";
import path from "node:path";
import type { Subject } from "./schema.js";

const DEVICE_PREFIX = /^(?:\\\\[.?]\\|\\\?\\|\\\.\\)/;
const DRIVE_RELATIVE = /^[a-zA-Z]:[^\\/]/;

export function normalizeWindowsPath(input: string): string {
  if (DEVICE_PREFIX.test(input)) {
    throw new Error("Windows device paths are not supported.");
  }
  if (DRIVE_RELATIVE.test(input)) {
    throw new Error("Drive-relative paths are not supported.");
  }
  const resolved = path.resolve(input);
  const parsed = path.parse(resolved);
  const remainder = resolved.slice(parsed.root.length);
  if (remainder.split(/[\\/]/).some((part) => part.includes(":"))) {
    throw new Error("Alternate data streams are not supported.");
  }
  return trimTrailingSeparator(resolved).toLocaleLowerCase("en-US");
}

function trimTrailingSeparator(value: string): string {
  const root = path.parse(value).root;
  while (value.length > root.length && /[\\/]$/.test(value)) {
    value = value.slice(0, -1);
  }
  return value;
}

export function canonicalizeExistingPath(input: string): string {
  const resolved = path.resolve(input);
  const real = fs.realpathSync.native(resolved);
  return normalizeWindowsPath(real);
}

export function canonicalizeProspectivePath(input: string): string {
  const absolute = path.resolve(input);
  let cursor = absolute;
  const suffix: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const existing = fs.existsSync(cursor) ? fs.realpathSync.native(cursor) : cursor;
  return normalizeWindowsPath(path.join(existing, ...suffix));
}

export function pathContains(rootInput: string, candidateInput: string): boolean {
  const root = normalizeWindowsPath(rootInput);
  const candidate = normalizeWindowsPath(candidateInput);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export function subjectSpecificity(subject: Subject | undefined): number {
  if (!subject) return 0;
  if (subject.kind === "path" || subject.kind === "executable") {
    return normalizeWindowsPath(subject.value).length + 100;
  }
  return subject.value.length + 50;
}

export function subjectsMatch(ruleSubject: Subject, requestSubject: Subject | undefined): boolean {
  if (!requestSubject || ruleSubject.kind !== requestSubject.kind) return false;
  if (ruleSubject.kind === "path") {
    return pathContains(ruleSubject.value, requestSubject.value);
  }
  if (ruleSubject.kind === "executable") {
    return normalizeWindowsPath(ruleSubject.value) === normalizeWindowsPath(requestSubject.value);
  }
  return ruleSubject.value.toLocaleLowerCase("en-US") === requestSubject.value.toLocaleLowerCase("en-US");
}
