import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Safety Incident Log setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Injuries, near-misses, and shop hazards with a corrective action to closure. Setup badge is **Needs setup**. Setup keeps one **Choose your team** primary. Header related strip is **Safety log · Safety training · FMEA**. Last snapshot (`feature: \"incidents\"`) keys the cache by season. Student chrome says **Needs setup**, not Setup.");
  });
});
