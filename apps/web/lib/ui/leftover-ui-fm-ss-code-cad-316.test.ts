import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Code & CAD setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Hub cards: Programming setup, Learn Onshape, Onshape drawings, Team 6925 lab. Setup badge is **Needs setup**. No-team primary is **Choose your team**. Student chrome says **Needs setup**, not Setup.");
  });
});
