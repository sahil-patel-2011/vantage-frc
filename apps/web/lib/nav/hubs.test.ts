import { describe, expect, it } from "vitest";
import {
  hubById,
  hubFeaturedMoreTabs,
  hubHref,
  hubMoreTabs,
  hubPrimaryTabs,
  isHubTab,
  PRODUCT_HUBS,
} from "./hubs";

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
    expect(more).toContain("sponsor-renewal-roi");
    expect(more).toContain("grant-eligibility-matcher");
    expect(more).toContain("matching-gift-finder");
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
    expect(hubMoreTabs(team).map((tab) => tab.id)).toContain("task-board");
    expect(team.tabs.find((tab) => tab.id === "todos")?.legacyHref).toBe("/todos");
  });

  it("surfaces Build shop tabs including prototypes", () => {
    const build = hubById("build");
    expect(hubPrimaryTabs(build).map((tab) => tab.id)).toEqual([
      "kickoff",
      "cad",
      "code",
      "fmea",
      "prototype",
      "batteries",
    ]);
    expect(hubMoreTabs(build).map((tab) => tab.id)).not.toContain("prototype");
    expect(hubMoreTabs(build).map((tab) => tab.id)).not.toContain("prototype-tracker");
    expect(hubMoreTabs(build).map((tab) => tab.id)).toContain("cad-change-radar");
    expect(hubMoreTabs(build).map((tab) => tab.id)).toContain("bin-shelf-locator");
  });

  it("surfaces AI hub tabs for chat, budgets, writer, code, and memory", () => {
    const ai = hubById("ai");
    expect(hubPrimaryTabs(ai).map((tab) => tab.id)).toEqual([
      "chat",
      "budgets",
      "writer",
      "code",
      "memory",
      "governance",
      "finance",
    ]);
    expect(hubMoreTabs(ai).map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["ai-keys", "usage", "decisions", "decision-search", "season-report"]),
    );
  });

  it("pins Alliance desk, Season planning, and AI keys as featured More tools", () => {
    expect(hubFeaturedMoreTabs(hubById("competition")).map((tab) => tab.id)).toContain(
      "alliance-selection-desk",
    );
    expect(hubFeaturedMoreTabs(hubById("team")).map((tab) => tab.id)).toContain(
      "season-planning-workspace",
    );
    expect(hubFeaturedMoreTabs(hubById("ai")).map((tab) => tab.id)).toEqual(["ai-keys"]);
  });
});
