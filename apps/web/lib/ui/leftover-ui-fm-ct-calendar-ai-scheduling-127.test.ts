import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Calendar AI scheduling choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Model returns intent only (kind, duration, subteam, stated weekday/hour); every slot comes from `lib/calendar-ai/availability` over this org’s past sessions, RSVPs and attendance, conflict-checked against the calendar; needs ≥3 past sessions before a slot counts as a pattern; writes nothing — picking one fills the create form. No history → no proposals, and it says so Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
