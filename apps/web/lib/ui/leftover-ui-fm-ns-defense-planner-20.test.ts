import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Defense Planner needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Mass/drivetrain vs scouted cycle defense plans; empty/setup + next actions; UsageCutoffBanner on metered matchup writes; Strategy / Scouting / Counter-book via hubHref Setup badge is **Needs setup**.");
  });
});
