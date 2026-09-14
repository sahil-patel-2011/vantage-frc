import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Morning standup choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Yesterday's closed hours and task movement; empty/setup one primary; related **Hours · Season Goals · Meeting agenda**; Next-actions on ready. Setup badge is **Needs setup**. Last snapshot stays on this phone (`feature: \"standup-digest\"`, `if (!view)`). No-team primary is **Choose your team**.");
  });
});
