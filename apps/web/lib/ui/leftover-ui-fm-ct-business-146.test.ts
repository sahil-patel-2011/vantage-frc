import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Business choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Overview · **Money** · Budget · Orders · Sponsors · Sponsorship · Grants · … — sponsor tabs hide when org `sponsors_allowed=false`. Setup badge is **Needs setup**. Header related strip is **Sponsors · Grants · Budget**. Last snapshot (`feature: \"business\"`). Working funds blank until a budget or recorded cash exists. No-team primary is **Choose your team**.");
  });
});
