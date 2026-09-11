/**
 * Source lock for Business / funding GUI: hub, Money, Sponsors, Grants,
 * Budget, and Grant calendar. Event day, marketing, CAD viewport, and Team
 * people files are owned by other agents and are not rewritten here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_FUNDING_RELATED_INCLUDE, businessRelatedLinks } from "../business/business-related";
import { hubById, hubFeaturedMoreTabs } from "../nav/hubs";
import { sponsorSuiteShellCopy } from "../sponsor-suite/sponsor-suite-related";
import { sponsorWallShellCopy } from "../sponsor-wall/sponsor-wall-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const SLICE = [
  "app/business/business-client.tsx",
  "app/business/business-panels.tsx",
  "app/business/business-helpers.ts",
  "app/business/season-finance-client.tsx",
  "app/business/sponsor-pipeline-panel.tsx",
  "app/business/partner-placements-panel.tsx",
  "app/budget/budget-client.tsx",
  "app/costs/costs-client.tsx",
  "app/team/grants/grants-client.tsx",
  "app/team/grants/calendar/calendar-client.tsx",
  "lib/business/business-related.ts",
  "lib/nav/hubs.ts",
] as const;

function read(rel: string): string {
  return readFileSync(join(WEB, rel), "utf8");
}

describe("Business funding GUI student chrome", () => {
  it("this week's strip is Sponsors · Grants · Budget and Budget is featured", () => {
    expect([...BUSINESS_FUNDING_RELATED_INCLUDE]).toEqual(["sponsors", "budget", "grants"]);
    const links = businessRelatedLinks("org-1", { include: [...BUSINESS_FUNDING_RELATED_INCLUDE] });
    expect(links.map((link) => link.label)).toEqual(["Sponsors", "Grants", "Budget"]);
    expect(hubById("business").tabs.find((tab) => tab.id === "budget")?.featured).toBe(true);
    expect(hubFeaturedMoreTabs(hubById("business")).map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["parts-catalog", "grant-calendar"]),
    );
  });

  it("Business hub, Money, and Partners keep last snapshot and Choose your team on 401/403", () => {
    const hub = read("app/business/business-client.tsx");
    expect(hub).toMatch(/putFeatureSnapshot\("business"/);
    expect(hub).toMatch(/getFeatureSnapshot/);
    expect(hub).toMatch(/hadCache \|\| viewRef\.current/);
    expect(hub).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(hub).toMatch(/Choose your team/);
    expect(hub).toMatch(/BUSINESS_FUNDING_RELATED_INCLUDE/);
    expect(hub).toMatch(/AbortSignal\.timeout\(FEATURE_API_TIMEOUT_MS\)/);
    expect(hub).toMatch(/badge="Needs setup"/);
    expect(hub).toMatch(/if \(!viewRef\.current && cached\?\.data/);

    const money = read("app/business/season-finance-client.tsx");
    expect(money).toMatch(/putFeatureSnapshot\("season-finance"/);
    expect(money).toMatch(/hadCache \|\| viewHold\.current/);
    expect(money).toMatch(/badge="Needs setup"/);
    expect(money).toMatch(/Choose your team/);

    const partners = read("app/business/partner-placements-panel.tsx");
    expect(partners).toMatch(/putFeatureSnapshot\("partner-placements"/);
    expect(partners).toMatch(/hadCache \|\| programHold\.current/);
    expect(partners).toMatch(/Choose your team/);
  });

  it("does not print Setup required, Stripe, or OAuth on this slice", () => {
    for (const rel of SLICE) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/\bStripe\b/);
      expect(src, rel).not.toMatch(/\bOAuth\b/);
      expect(src, rel).not.toMatch(/STRIPE_/);
    }
    expect(sponsorWallShellCopy("setup").badge).toBe("Needs setup");
    expect(sponsorSuiteShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(sponsorWallShellCopy("setup").description);
  });

  it("Overview does not invent a $0 working-funds total", () => {
    const panels = read("app/business/business-panels.tsx");
    expect(panels).toMatch(/hasRecordedWorkingFunds/);
    expect(panels).toMatch(/moneyWhenRecorded/);
    expect(panels).toMatch(/fundsOnRecord \? money\(available\) : "—"/);
    expect(panels).not.toMatch(/Kpi label="Working funds" value=\{money\(available\)\}/);
  });
});
