import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Safety log setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Incidents, near-misses, and tool certifications. Setup badge is **Needs setup**. Setup keeps one **Choose your team** primary. Header related strip is **Safety Incident Log · Safety training**. Last snapshot stays on this phone (`feature: \"safety\"`). 401/403 drops the painted board. Student chrome says **Needs setup**, not Setup.");
  });
});
