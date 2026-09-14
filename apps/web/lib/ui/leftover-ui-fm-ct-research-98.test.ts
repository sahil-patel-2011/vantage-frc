import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Research choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Look up another FRC team by number or name. Season scores, our scouting, and public notes stay blank until they exist. Setup badge is **Needs setup**. Related: Strategy · Team dossier · Scouting. Next-actions (pick desk, chemistry) only after a team is open. Last snapshot stays on this phone (`feature: \"intel\"`, `if (!view)`). Student chrome says **Rating**, not EPA. Overnight brief is `/overnight-intel`. No-team primary is **Choose your team**.");
  });
});
