import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map AI Bugbot choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Connect GitHub (read-only) then scan pasted file or robot-code tree. **Subscription** = team's keys or plan allowance. **Bugbot Ultra** = hosted SKU `$1` scan / `$2` fix / `$1` recheck. Header prints model, files scanned, and wall-clock duration from the chunk loop. Findings must quote source or they are dropped; proposed diffs are human-approved and never pushed Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
