import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Event readiness choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Remaining blockers for one event date — consent, packing, travel, and inspection roll up here. Last snapshot stays on this phone (`if (!view)`); a failed refresh does not blank a painted board. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
