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
  it("lists every place once, with at most four sections each", () => {
    const sections = mainMenuSections(PRODUCT_NAV_GROUPS, () => true);
    const items = sections.flatMap(section => section.items);
    expect(new Set(items.map(item => item.href)).size).toBe(items.length);
    for (const section of sections) expect(section.items.length, section.id).toBeLessThanOrEqual(4);
    expect(sections.find(section => section.id === "competition")?.items.map(item => item.label)).toEqual(["Scout", "Match plan", "Event day"]);
    // These live in More tools (and stay pinnable and searchable).
    expect(items.some(item => ["Teams", "Pick list", "Our robot", "Scouting forms", "My Day", "Pit TV", "Team resources", "Playbook", "Grants"].includes(item.label))).toBe(false);
    // Four workspaces; Ask AI has its own door (sidebar footer, phone top bar), not a section.
    expect(sections.map(section => section.label)).toEqual(["Competition", "Team", "Build", "Business"]);
  });
  it("marks Event day while you are on My Day, the section it lives under", () => {
    expect(mainMenuSearch("/competition", "tab=my-day")).toBe("tab=command");
  });
  it("never grants workspace, section, or sponsor access through the menu", () => {
    const access = [{ hubId: "competition" as const, allowedTabIds: ["scouting"] }];
    const sections = mainMenuSections(PRODUCT_NAV_GROUPS, href => pathAllowedByHubAccess(href, access));
    expect(sections.some(section => section.id === "ai")).toBe(false);
    expect(sections.flatMap(section => section.items).some(item => item.href.includes("tab=strategy"))).toBe(false);
    expect(sections.flatMap(section => section.items).some(item => item.label === "Pit TV")).toBe(false);
    const sponsors = mainMenuSections(PRODUCT_NAV_GROUPS, href => pathAllowedBySponsors(href, false));
    expect(sponsors.flatMap(section => section.items).some(item => item.href.includes("tab=sponsors"))).toBe(false);
  });
});
