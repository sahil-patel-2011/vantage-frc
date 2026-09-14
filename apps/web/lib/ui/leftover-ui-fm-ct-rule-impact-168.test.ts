import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Rule Impact choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Game-manual deltas × prior-season subsystem library; empty/setup + next actions; still-legal / rework / blocked from logged rules only; cross-links to Kickoff / CAD / Subsystems Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
