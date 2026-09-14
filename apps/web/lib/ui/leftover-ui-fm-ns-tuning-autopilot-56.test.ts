import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Tuning Autopilot needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("PID/feedforward next-gain suggestions from logged iterations only; empty/setup + next actions; cross-links to CAD / FMEA / Practice Setup badge is **Needs setup**.");
  });
});
