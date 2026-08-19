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
  it("defines the six shipping hubs", () => {
    expect(PRODUCT_HUBS.map((hub) => hub.id)).toEqual([
      "competition", "team", "business", "build", "ai", "media",
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
      "finance",
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
    expect(more).not.toContain("media");
    expect(more).toContain("media-kit");
  });

  it("surfaces Media hub tabs for calendar, drafts, reminders, kit, and impact", () => {
    const media = hubById("media");
    expect(hubPrimaryTabs(media).map((tab) => tab.id)).toEqual([
      "calendar",
      "drafts",
      "reminders",
      "kit",
      "impact",
    ]);
    expect(media.tabs.find((tab) => tab.id === "kit")?.legacyHref).toBe("/media-kit");
  });

  it("keeps Team primary tabs to calendar, chat, todos, practice, and attendance", () => {
    const team = hubById("team");
    expect(hubPrimaryTabs(team).map((tab) => tab.id)).toEqual([
      "calendar",
      "messages",
      "todos",
      "practice",
      "attendance",
    ]);
    expect(hubMoreTabs(team).map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["knowledge", "batteries", "fmea"]),
    );
    expect(hubMoreTabs(team).map((tab) => tab.id)).toContain("task-board");
    expect(team.tabs.find((tab) => tab.id === "todos")?.legacyHref).toBe("/todos");
  });

  it("keeps Build primary tabs to kickoff, CAD, and code", () => {
    const build = hubById("build");
    expect(hubPrimaryTabs(build).map((tab) => tab.id)).toEqual(["kickoff", "cad", "code"]);
    expect(hubMoreTabs(build).map((tab) => tab.id)).toContain("prototype");
    expect(hubMoreTabs(build).map((tab) => tab.id)).toContain("fmea");
    expect(hubMoreTabs(build).map((tab) => tab.id)).toContain("batteries");
    expect(hubMoreTabs(build).map((tab) => tab.id)).toContain("cad-change-radar");
    expect(hubMoreTabs(build).map((tab) => tab.id)).toContain("bin-shelf-locator");
    expect(hubMoreTabs(build).map((tab) => tab.id)).toContain("bugbot");
  });

  it("keeps AI primary tabs to chat, writer, budgets, agent, and finance", () => {
    const ai = hubById("ai");
    expect(hubPrimaryTabs(ai).map((tab) => tab.id)).toEqual([
      "chat",
      "writer",
      "budgets",
      "agent",
      "finance",
    ]);
    expect(hubMoreTabs(ai).map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["code", "bugbot", "memory", "governance"]),
    );
    expect(hubMoreTabs(ai).map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["ai-keys", "usage", "decisions", "decision-search", "season-report"]),
    );
  });

  it("pins Alliance desk, Season planning, and AI keys as featured More tools", () => {
    expect(hubFeaturedMoreTabs(hubById("competition")).map((tab) => tab.id)).toEqual([
      "alliance-selection-desk",
    ]);
    expect(hubFeaturedMoreTabs(hubById("team")).map((tab) => tab.id)).toContain(
      "season-planning-workspace",
    );
    expect(hubFeaturedMoreTabs(hubById("ai")).map((tab) => tab.id)).toEqual(["ai-keys"]);
  });
});
