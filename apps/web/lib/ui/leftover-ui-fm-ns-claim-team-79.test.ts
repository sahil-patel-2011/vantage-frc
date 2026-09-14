import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Claim team needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Self-serve org via `claim_frc_team_workspace` (verified email, unused official team number in `teams_ref`); members still exact-email invite; STIMS remains official Setup badge is **Needs setup**.");
  });
});
