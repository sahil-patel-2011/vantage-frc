import { describe, expect, it } from "vitest";
import { safeAppPath } from "./safe-navigation";

describe("safeAppPath", () => {
  it("keeps valid application paths", () => {
    expect(safeAppPath("/start?orgId=abc#next")).toBe("/start?orgId=abc#next");
  });

  it("blocks absolute, scheme-relative, backslash, and control-character redirects", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example/path",
      "/\\evil.example/path",
      "/%5cevil.example/path",
      "/%2f%2fevil.example/path",
      "/safe\nLocation: https://evil.example",
      "dashboard",
    ]) {
      expect(safeAppPath(value, "/workspace")).toBe("/workspace");
    }
  });
});
