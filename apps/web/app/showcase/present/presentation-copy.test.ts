import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Showcase present is student copy", () => {
  it("does not dump VANTAGE leftover on the print view", () => {
    const src = readFileSync(join(__dirname, "presentation-client.tsx"), "utf8");
    expect(src).toMatch(/Season showcase/);
    expect(src).not.toMatch(/VANTAGE \//);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
  });
});
