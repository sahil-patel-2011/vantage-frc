import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Season Planning Workspace choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Goals → milestones → owners + ICS calendar hooks; progress from real attendance / build_tasks only Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
