import { describe, expect, it } from "vitest";
import { EMPTY_COVERAGE } from "./code-model";

describe("code-model", () => {
  it("starts a scan with empty coverage, never a DEMO file list", () => {
    expect(EMPTY_COVERAGE.reviewedFiles).toEqual([]);
    expect(EMPTY_COVERAGE.skipped).toEqual([]);
    expect(EMPTY_COVERAGE.candidateCount).toBe(0);
    expect(JSON.stringify(EMPTY_COVERAGE)).not.toMatch(/demo/i);
  });
});
