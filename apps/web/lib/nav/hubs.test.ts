import { describe, expect, it } from "vitest";
import {
  hubById,
  hubFeaturedMoreTabs,
  hubHref,
  hubMoreTabs,
  hubNestedTabs,
  hubPrimaryTabs,
  hubWorkbenchId,
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

  it("keeps a short workbench TabBar with inner tools instead of a More-tools dump", () => {
    for (const hub of PRODUCT_HUBS) {
      const workbenches = hubPrimaryTabs(hub);
      expect(workbenches.length).toBeGreaterThanOrEqual(3);
      expect(workbenches.length).toBeLessThanOrEqual(6);
      expect(workbenches.every((tab) => !tab.group)).toBe(true);
    }
  });

  it("nests Business money / sponsors / grants / outreach under four workbenches", () => {
    const business = hubById("business");
    expect(hubPrimaryTabs(business).map((tab) => tab.id)).toEqual([
      "overview",
      "finance",
      "sponsors",
      "grants",
      "evidence",
    ]);
    expect(hubNestedTabs(business, "finance").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["finance", "budget", "orders", "costs"]),
    );
    expect(hubMoreTabs(business).map((tab) => tab.id)).toContain("fundraisers");
    expect(hubMoreTabs(business).map((tab) => tab.id)).toContain("impact");
    expect(hubMoreTabs(business).map((tab) => tab.id)).not.toContain("media");
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

  it("keeps Team workbenches to calendar, chat, people, work, and playbook", () => {
    const team = hubById("team");
    expect(hubPrimaryTabs(team).map((tab) => tab.id)).toEqual([
      "calendar",
      "messages",
      "attendance",
      "todos",
      "knowledge",
    ]);
    expect(team.tabs.find((tab) => tab.id === "knowledge")?.label).toBe("Playbook");
    expect(hubNestedTabs(team, "todos").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["practice", "batteries", "fmea", "season-planning-workspace"]),
    );
    expect(team.tabs.find((tab) => tab.id === "todos")?.legacyHref).toBe("/todos");
  });

  it("keeps Build workbenches to kickoff, CAD, code, and robot", () => {
    const build = hubById("build");
    expect(hubPrimaryTabs(build).map((tab) => tab.id)).toEqual(["kickoff", "cad", "code", "fmea"]);
    expect(hubNestedTabs(build, "fmea").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["prototype", "batteries", "robot"]),
    );
    expect(hubNestedTabs(build, "cad").map((tab) => tab.id)).toContain("cad-change-radar");
    expect(hubNestedTabs(build, "code").map((tab) => tab.id)).toContain("bugbot");
  });

  it("keeps AI workbenches to chat, writer, agent, controls, and notes", () => {
    const ai = hubById("ai");
    expect(hubPrimaryTabs(ai).map((tab) => tab.id)).toEqual([
      "chat",
      "writer",
      "agent",
      "budgets",
      "decisions",
    ]);
    expect(hubNestedTabs(ai, "budgets").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["memory", "governance", "finance", "ai-keys"]),
    );
    expect(hubNestedTabs(ai, "decisions").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["decision-search", "season-report"]),
    );
  });

  it("resolves nested tools back to their workbench", () => {
    const competition = hubById("competition");
    expect(hubWorkbenchId(competition, "forms")).toBe("scouting");
    expect(hubWorkbenchId(competition, "pick-clock")).toBe("strategy");
    expect(hubWorkbenchId(competition, "command")).toBe("command");
    expect(hubPrimaryTabs(competition).map((tab) => tab.id)).toEqual([
      "command",
      "scouting",
      "strategy",
      "match-checklist",
    ]);
    expect(hubNestedTabs(competition, "command").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["command", "my-day"]),
    );
  });

  it("pins Alliance desk, Season planning, and AI keys as featured inner tools", () => {
    expect(hubFeaturedMoreTabs(hubById("competition")).map((tab) => tab.id)).toEqual([
      "alliance-selection-desk",
    ]);
    expect(hubFeaturedMoreTabs(hubById("team")).map((tab) => tab.id)).toContain(
      "season-planning-workspace",
    );
    expect(hubFeaturedMoreTabs(hubById("ai")).map((tab) => tab.id)).toEqual(["ai-keys"]);
  });
});
