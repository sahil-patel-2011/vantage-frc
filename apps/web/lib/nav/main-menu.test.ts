import { describe, expect, it } from "vitest";
import { mainMenuSearch, mainMenuSections } from "./main-menu";
import { PRODUCT_NAV_GROUPS } from "./product-nav";
import { pathAllowedByHubAccess, pathAllowedBySponsors } from "./hub-access-filter";

describe("one main menu", () => {
  it("keeps the sidebar scouting destination for a collection-only member without duplicating it", () => {
    const sections = mainMenuSections(PRODUCT_NAV_GROUPS, href => href === "/competition?tab=scouting", true);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("competition");
    expect(sections[0]?.items).toEqual([{ href: "/competition?tab=scouting", label: "Scout", icon: "scout" }]);
  });
  it("marks default tasks on root URLs while preserving explicit choices and the team", () => {
    expect(mainMenuSearch("/competition", "?orgId=team")).toBe("orgId=team&tab=scouting");
    expect(mainMenuSearch("/business", "")).toBe("tab=overview");
    expect(mainMenuSearch("/ai", "")).toBe("tab=chat");
    expect(mainMenuSearch("/competition", "tab=teams&orgId=team")).toBe("tab=teams&orgId=team");
    expect(mainMenuSearch("/dashboard", "orgId=team")).toBe("orgId=team");
    // Writer folded into Ask AI; the next AI section a member may open is Controls.
    expect(mainMenuSearch("/ai", "", href => href.endsWith("tab=budgets"))).toBe("tab=budgets");
    expect(mainMenuSearch("/ai", "", () => false)).toBe("");
  });
  it("lists every place once, so un-pinning Scout, My Day or Team resources never hides it", () => {
    const sections = mainMenuSections(PRODUCT_NAV_GROUPS, () => true);
    const items = sections.flatMap(section => section.items);
    expect(new Set(items.map(item => item.href)).size).toBe(items.length);
    // Pit TV and Assignments open their own pages directly, not a hub that replaces itself.
    expect(items).toContainEqual({ href: "/display", label: "Pit TV", icon: "display" });
    expect(items.some(item => item.href === "/scout-coverage-live" && item.label === "Assignments")).toBe(true);
    expect(items.some(item => item.href === "/competition?tab=scouting")).toBe(true);
    expect(items.some(item => item.href === "/competition?tab=my-day")).toBe(true);
    const competition = sections.find(section => section.id === "competition")?.items ?? [];
    const planAt = competition.findIndex(item => item.label === "Match plan");
    expect(competition[planAt + 1]).toEqual({ href: "/match-sim", label: "Match prediction", icon: "target" });
    expect(sections.find(section => section.id === "team")?.items).toContainEqual({ href: "/learn/team", label: "Team resources", icon: "book" });
    // Four workspaces; Ask AI has its own door (sidebar footer, phone top bar), not a section.
    expect(sections.map(section => section.label)).toEqual(["Competition", "Team", "Build", "Business"]);
  });
  it("marks My Day itself, not Event day, while you are on it", () => {
    expect(mainMenuSearch("/competition", "tab=my-day")).toBe("tab=my-day");
  });
  it("never grants workspace, section, or sponsor access through the menu", () => {
    const access = [{ hubId: "competition" as const, allowedTabIds: ["scouting"] }];
    const sections = mainMenuSections(PRODUCT_NAV_GROUPS, href => pathAllowedByHubAccess(href, access));
    expect(sections.some(section => section.id === "ai")).toBe(false);
    expect(sections.flatMap(section => section.items).some(item => item.href.includes("tab=strategy"))).toBe(false);
    expect(sections.flatMap(section => section.items).some(item => item.href === "/match-sim")).toBe(false);
    expect(sections.flatMap(section => section.items).some(item => item.label === "Pit TV")).toBe(false);
    const sponsors = mainMenuSections(PRODUCT_NAV_GROUPS, href => pathAllowedBySponsors(href, false));
    expect(sponsors.flatMap(section => section.items).some(item => item.href.includes("tab=sponsors"))).toBe(false);
  });
});
