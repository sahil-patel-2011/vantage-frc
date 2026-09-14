import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Business fundraisers choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("events + goal progress from recorded deposits/goals only; empty/setup + next actions; cross-links to Sponsors / Grants / Orders Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
