import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Team 6925 lab setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Limelight, WPILib, PathPlanner, GitHub Student Pack, and five paced weeks. Official https docs only. Setup badge is **Needs setup**. No-team primary is **Choose your team**. Student chrome says **Needs setup**, not Setup.");
  });
});
