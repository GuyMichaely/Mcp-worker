import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeWindowsPath, pathContains } from "../src/path-policy.js";

describe("Windows path policy", () => {
  it("uses component boundaries for containment", () => {
    const root = path.resolve("C:\\work");
    expect(pathContains(root, path.join(root, "child", "file.txt"))).toBe(true);
    expect(pathContains(root, `${root}-other\\file.txt`)).toBe(false);
  });

  it("rejects alternate data streams", () => {
    expect(() => normalizeWindowsPath("C:\\work\\file.txt:secret")).toThrow(/Alternate data streams/);
  });

  it("rejects device paths", () => {
    expect(() => normalizeWindowsPath("\\\\?\\C:\\work\\file.txt")).toThrow(/device paths/);
  });
});
