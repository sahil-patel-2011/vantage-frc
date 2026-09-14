import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Drive-team tags setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Pairwise 2.0-style qualitative tags on event robots (defense, climb, partner fit); empty board until applied Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary. Student chrome says **Needs setup**, not Setup.");
  });
});
