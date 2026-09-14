import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Business season finance choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Funding sources (school, fees, grants, sponsors, fundraisers) + purchase log + rollup of CRM / grants / fundraisers / orders / season costs; empty/setup + next actions. Setup badge is **Needs setup**. Last snapshot (`feature: \"season-finance\"`). Planned income / remaining stay **—** until a plan exists. No-team primary is **Choose your team**.");
  });
});
