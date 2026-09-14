import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Outreach by person needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("`impact_activity_participants` (0643): name teammates on an activity, each with their OWN minutes; blank = \"time not recorded\", shown and never counted; the activity's duration is never credited automatically; participant_count stays the headline and may exceed the named list. RLS refuses a user from another org at the policy Setup badge is **Needs setup**.");
  });
});
