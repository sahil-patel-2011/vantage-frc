import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Season Goals setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Set season targets and log check-ins from real values; empty/setup one primary; related **Standup · Meeting agenda · Season plan**; Next-actions on ready. Setup badge is **Needs setup**. Last snapshot stays on this phone (`feature: \"goals-tracker\"`, `if (!view)`). No-team primary is **Choose your team**. Empty keeps one primary. Student chrome says **Needs setup**, not Setup.");
  });
});
