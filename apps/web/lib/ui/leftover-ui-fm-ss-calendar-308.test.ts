import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Calendar setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Day / Week timed grid (hours 7–22), Month, List; this team’s matches (real `matches_ref` times + bumper color) and GitHub due dates. Extra tools (phone calendar, duties, trip, subteams) sit under **More**. Match titles use Qualification / Quarterfinal, not Qual/QF. List empty points at Add event. Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary. Student chrome says **Needs setup**, not Setup.");
  });
});
