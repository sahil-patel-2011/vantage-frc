import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map AI Usage empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Metered calls, funding source, denials, member/model breakdown; empty/setup shells; UsageCutoffBanner consistency; Chat/Budgets/Pricing/Account via hubHref/withOrgHref. Setup badge is **Needs setup**. Summary tiles paint only when billed calls exist. Hosted key source is **Hosted**, not Hosted by Vantage. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
