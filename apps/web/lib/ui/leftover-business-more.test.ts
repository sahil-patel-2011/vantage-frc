import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Eligibility / Renewal ROI / Tier calculator /
 * Season costs / Mock judging titles after leftover-scout-more.
 * Hub labels stay Eligibility, Renewal ROI, Tier calculator,
 * Season costs, and Mock judging. leftover-business-titles Award
 * tracker family, leftover-people-more Matching gifts,
 * leftover-pick-before Choose your team, leftover-fmea Failure log,
 * leftover-help-workspace Connect TBA, leftover-media Photos & video,
 * leftover-safety Safety incidents, leftover-scout-more Accuracy
 * family stay. leftover-ops-more Skills / Risk register / Burndown
 * stay. Community Impact related-strip labels stay. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/grant-eligibility-matcher/grant-eligibility-matcher-client.tsx",
  "app/grant-eligibility-matcher/page.tsx",
  "lib/grant-eligibility-matcher/grant-eligibility-matcher-related.ts",
  "lib/manifests/grant-eligibility-matcher.manifest.ts",
  "app/sponsor-renewal-roi/sponsor-renewal-roi-client.tsx",
  "app/sponsor-renewal-roi/page.tsx",
  "lib/sponsor-renewal-roi/sponsor-renewal-roi-related.ts",
  "lib/manifests/sponsor-renewal-roi.manifest.ts",
  "app/sponsor-tier-calculator/sponsor-tier-calculator-client.tsx",
  "app/sponsor-tier-calculator/page.tsx",
  "lib/manifests/sponsor-tier-calculator.manifest.ts",
  "app/costs/costs-client.tsx",
  "app/costs/page.tsx",
  "lib/costs/costs-related.ts",
  "lib/business/business-related.ts",
  "lib/business/costs-next-actions.ts",
  "app/mock-judging/mock-judging-client.tsx",
  "app/mock-judging/page.tsx",
  "lib/manifests/mock-judging.manifest.ts",
  "lib/matching-gift-finder/matching-gift-finder-related.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student business-more chrome", () => {
  it("does not print leftover Grant Eligibility Matcher / Season Costs titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Grant Eligibility Matcher/);
      expect(src, rel).not.toMatch(/Sponsor Renewal-Risk Score/);
      expect(src, rel).not.toMatch(/Sponsor Renewal ROI/);
      expect(src, rel).not.toMatch(/Sponsor Tier Calculator/);
      expect(src, rel).not.toMatch(/Season Costs/);
      expect(src, rel).not.toMatch(/Mock Judging/);
    }
    const eligibility = readFileSync(
      join(WEB, "app/grant-eligibility-matcher/grant-eligibility-matcher-client.tsx"),
      "utf8",
    );
    expect(eligibility).toMatch(/title="Eligibility"/);
    expect(eligibility).toMatch(/feature="Eligibility"/);
    const eligibilityRelated = readFileSync(
      join(WEB, "lib/grant-eligibility-matcher/grant-eligibility-matcher-related.ts"),
      "utf8",
    );
    expect(eligibilityRelated).toMatch(/Opening Eligibility/);
    expect(eligibilityRelated).not.toMatch(/title="Loading/);
    expect(eligibilityRelated).toMatch(/Choose your team/);
    expect(eligibilityRelated).not.toMatch(/\bPick a team\b/);
    expect(eligibilityRelated).toMatch(/Open Community Impact/);
    const renewal = readFileSync(
      join(WEB, "app/sponsor-renewal-roi/sponsor-renewal-roi-client.tsx"),
      "utf8",
    );
    expect(renewal).toMatch(/title="Renewal ROI"/);
    expect(renewal).toMatch(/feature="Renewal ROI"/);
    const renewalRelated = readFileSync(
      join(WEB, "lib/sponsor-renewal-roi/sponsor-renewal-roi-related.ts"),
      "utf8",
    );
    expect(renewalRelated).toMatch(/Opening Renewal ROI/);
    expect(renewalRelated).not.toMatch(/title="Loading/);
    expect(renewalRelated).toMatch(/Choose your team/);
    expect(renewalRelated).not.toMatch(/\bPick a team\b/);
    const tier = readFileSync(
      join(WEB, "app/sponsor-tier-calculator/sponsor-tier-calculator-client.tsx"),
      "utf8",
    );
    expect(tier).toMatch(/title="Tier calculator"/);
    expect(tier).toMatch(/feature="Tier calculator"/);
    const costs = readFileSync(join(WEB, "app/costs/costs-client.tsx"), "utf8");
    expect(costs).toMatch(/title="Season costs"/);
    expect(costs).toMatch(/feature="Season costs"/);
    const judging = readFileSync(join(WEB, "app/mock-judging/mock-judging-client.tsx"), "utf8");
    expect(judging).toMatch(/title="Mock judging"/);
    expect(judging).toMatch(/feature="Mock judging"/);
    const gifts = readFileSync(
      join(WEB, "lib/matching-gift-finder/matching-gift-finder-related.ts"),
      "utf8",
    );
    expect(gifts).toMatch(/Open Renewal ROI/);
    expect(gifts).toMatch(/Matching gifts/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/grant-eligibility-matcher"\)\) return "Eligibility"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/sponsor-renewal-roi"\)\) return "Renewal ROI"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/sponsor-tier-calculator"\)\) return "Tier calculator"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/costs"\)\) return "Season costs"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/mock-judging"\)\) return "Mock judging"/);
  });
});
