import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map CAD naming lesson setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Subsystem · What it is · Which one; the \"what goes wrong\" gallery; why names feed the assembly manual, BOM and review. One verified link on purpose — Onshape's help soft-redirects wrong URLs to its landing page Setup badge is **Needs setup**. No-team primary is **Choose your team**. Student chrome says **Needs setup**, not Setup.");
  });
});
