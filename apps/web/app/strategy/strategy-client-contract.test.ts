import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "strategy-client.tsx"), "utf8");

describe("Strategy on-demand prediction", () => {
  it("POSTs recompute to /api/strategy instead of showing only a cached load", () => {
    expect(source).toContain("Recompute prediction");
    expect(source).toContain('action: "recompute"');
    expect(source).toContain('fetch("/api/strategy"');
    expect(source).toContain("method: \"POST\"");
    expect(source).toContain("predictionWinDisplay");
    expect(source).toContain("redWinDisplay");
    expect(source).not.toMatch(/view\.prediction\.pRed \* 100/);
  });
});
