import { describe, expect, it } from "vitest";
import { mainMenuSearch, mainMenuSections } from "./main-menu";
import { PRODUCT_NAV_GROUPS } from "./product-nav";
import { pathAllowedByHubAccess, pathAllowedBySponsors } from "./hub-access-filter";

describe("one main menu", () => {
  it("marks default tasks on root URLs while preserving explicit choices and the team", () => {
    expect(mainMenuSearch("/competition", "?orgId=team")).toBe("orgId=team&tab=scouting");
    expect(mainMenuSearch("/business", "")).toBe("tab=overview");
    expect(mainMenuSearch("/ai", "")).toBe("tab=chat");
    expect(mainMenuSearch("/competition", "tab=teams&orgId=team")).toBe("tab=teams&orgId=team");
    expect(mainMenuSearch("/dashboard", "orgId=team")).toBe("orgId=team");
    expect(mainMenuSearch("/ai", "", href => href.endsWith("tab=writer"))).toBe("tab=writer");
    expect(mainMenuSearch("/ai", "", () => false)).toBe("");
  });
  it("puts pit display in the menu and never repeats the Scouting launcher", () => {
    const sections = mainMenuSections(PRODUCT_NAV_GROUPS, () => true);
    const items = sections.flatMap(section => section.items);
    expect(new Set(items.map(item => item.href)).size).toBe(items.length);
    expect(items.some(item => item.label === "Pit display")).toBe(true);
    expect(items.some(item => item.href === "/competition?tab=scouting")).toBe(false);
    expect(sections.map(section => section.label)).toEqual(["Competition tools", "Team", "Build", "Business", "AI"]);
  });
  it("never grants workspace, section, or sponsor access through the menu", () => {
    const access = [{ hubId: "competition" as const, allowedTabIds: ["scouting"] }];
    const sections = mainMenuSections(PRODUCT_NAV_GROUPS, href => pathAllowedByHubAccess(href, access));
    expect(sections.some(section => section.id === "ai")).toBe(false);
    expect(sections.flatMap(section => section.items).some(item => item.href.includes("tab=strategy"))).toBe(false);
    expect(sections.flatMap(section => section.items).some(item => item.label === "Pit display")).toBe(false);
    const sponsors = mainMenuSections(PRODUCT_NAV_GROUPS, href => pathAllowedBySponsors(href, false));
    expect(sponsors.flatMap(section => section.items).some(item => item.href.includes("tab=sponsors"))).toBe(false);
  });
  it("keeps inner tools in their workbench and gives expanded destinations icons", () => {
    expect(mainMenuSearch("/competition", "tab=forms&orgId=team")).toBe("tab=forms&orgId=team");
    expect(mainMenuSearch("/competition", "tab=alliance-sim")).toBe("tab=strategy");
    expect(mainMenuSearch("/competition", "tab=picks")).toBe("tab=picks");
    expect(mainMenuSearch("/competition", "tab=pit-tv")).toBe("tab=pit-tv");
    expect(mainMenuSearch("/competition", "tab=forms", href => href.endsWith("tab=forms"))).toBe("tab=forms");
    const items = mainMenuSections(PRODUCT_NAV_GROUPS, () => true).flatMap(section => section.items);
    expect(items.every(item => Boolean(item.icon))).toBe(true);
    expect(items.filter(item => item.href === "/competition?tab=forms")).toHaveLength(1);
    expect(items.filter(item => item.href === "/competition?tab=scout-coverage-live")).toHaveLength(1);
  });
});
