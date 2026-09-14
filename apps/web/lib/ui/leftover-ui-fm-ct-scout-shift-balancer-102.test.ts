import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Scout shift balancer choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Fatigue-capped rotations; qual overlay from Team Data; CSV + per-scout tablet sheets; lunch-sized schedule gaps flagged Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
