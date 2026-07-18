import { describe, expect, it } from "vitest";
import { hubById, hubHref, hubMoreTabs, hubPrimaryTabs, isHubTab, PRODUCT_HUBS } from "./hubs";

describe("product hubs", () => {
  it("defines the five shipping hubs", () => {
    expect(PRODUCT_HUBS.map((hub) => hub.id)).toEqual([
      "competition", "team", "business", "build", "ai",
    ]);
  });
  it("validates tabs and builds deep links", () => {
    const competition = hubById("competition");
    expect(isHubTab(competition, "scouting")).toBe(true);
    expect(isHubTab(competition, "pit")).toBe(false);
    expect(hubHref("/business", "orders", "org-1")).toBe("/business?tab=orders&orgId=org-1");
  });
  it("keeps Business More tools for costs, impact, and award surfaces", () => {
    const business = hubById("business");
    const more = hubMoreTabs(business).map((tab) => tab.id);
    expect(hubPrimaryTabs(business).map((tab) => tab.id)).toEqual([
      "overview",
      "budget",
      "orders",
      "sponsors",
      "sponsorship",
      "grants",
      "placements",
      "evidence",
    ]);
    expect(more).toContain("costs");
    expect(more).toContain("fundraisers");
    expect(more).toContain("impact");
    expect(more).toContain("award-tracker");
    expect(more).toContain("grant-report");
  });

  it("surfaces Team ops tabs including batteries and FMEA", () => {
    const team = hubById("team");
    expect(hubPrimaryTabs(team).map((tab) => tab.id)).toEqual([
      "calendar",
      "todos",
      "messages",
      "practice",
      "knowledge",
      "attendance",
      "batteries",
      "fmea",
    ]);
  });
});
