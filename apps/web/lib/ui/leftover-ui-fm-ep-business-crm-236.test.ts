import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Business CRM empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("pipeline / packages / placements; empty/setup + next actions; cross-links to fundraisers, grants, orders, Ask AI about money; packageId on this team. Setup badge is **Needs setup**. Partners last snapshot (`feature: \"partner-placements\"`). Direct payment link is the team's own URL — no Stripe/OAuth words. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
