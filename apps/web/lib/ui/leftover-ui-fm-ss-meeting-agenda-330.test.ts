import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Meeting agenda setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Agenda and minutes attach to a calendar meeting; empty/setup one primary; related **Calendar · Standup · Season Goals**; Next-actions on ready. Setup badge is **Needs setup**. Last snapshot stays on this phone (`feature: \"meeting-autopilot\"`, `if (!view)`). Student chrome is **Meeting agenda**, not Meeting-agenda autopilot. No-team primary is **Choose your team**. Empty keeps one primary. Student chrome says **Needs setup**, not Setup.");
  });
});
