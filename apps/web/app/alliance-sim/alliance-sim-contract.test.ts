import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "alliance-sim-client.tsx"), "utf8");

describe("Alliance Sim display honesty", () => {
  it("shows role coverage, not a heuristic as a match win %", () => {
    expect(source).toContain("result.coverageRatio");
    expect(source).toContain("not a match win prediction");
    expect(source).not.toMatch(/fontSize: "2rem"[^>]*>\{pct\(result\.winProbability\)\}/);
  });
});
