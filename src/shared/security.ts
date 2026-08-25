import { createHash, timingSafeEqual } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifySecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(sha256(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)])
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function requestHash(toolName: string, argumentsValue: unknown): string {
  return sha256(canonicalJson({ toolName, arguments: argumentsValue }));
}

const secretName = /(token|secret|password|credential|cookie|authorization|api[-_]?key)/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        secretName.test(key) ? "[REDACTED]" : redact(child)
      ])
    );
  }
  return value;
}
