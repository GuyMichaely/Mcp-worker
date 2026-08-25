import { describe, expect, it } from "vitest";
import { canonicalJson, redact, requestHash, sha256, verifySecret } from "../src/shared/security.js";

describe("security helpers", () => {
  it("compares hashed bearer secrets", () => {
    const hash = sha256("correct horse");
    expect(verifySecret("correct horse", hash)).toBe(true);
    expect(verifySecret("wrong", hash)).toBe(false);
  });

  it("hashes requests without object-key ordering drift", () => {
    expect(requestHash("x", { a: 1, b: 2 })).toBe(requestHash("x", { b: 2, a: 1 }));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("redacts secret-shaped fields at every depth", () => {
    expect(redact({ token: "x", nested: { apiKey: "y", safe: 1 } })).toEqual({
      token: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", safe: 1 }
    });
  });
});
