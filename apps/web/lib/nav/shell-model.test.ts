import { describe, expect, it } from "vitest";
import { PRODUCT_HUBS, hubPrimaryTabs } from "./hubs";
import {
  buildShellHubs,
  resolveShellRecents,
  dedupeSidebarQuickActions,
  shellQuickActions,
  stripOrg,
} from "./shell-model";

const allow = () => true;

describe("shell model", () => {
  it("lists every pillar with two disclosure levels at most", () => {
    const hubs = buildShellHubs({ pathname: "/dashboard", search: "", activeGroupLabel: "Home", isAllowed: allow });
    expect(hubs.map((hub) => hub.label)).toEqual([
      "Home", "Competition", "Team", "Logistics", "Business", "Media", "Build", "AI",
    ]);
    expect(hubs[0]?.tabs).toEqual([]);
    for (const hub of hubs) {
      // Workbench tabs only — never the deep tool list.
      expect(hub.tabs.length).toBeLessThanOrEqual(6);
      for (const tab of hub.tabs) expect(tab.href.split("?")[0]).not.toContain("//");
    }
  });

  it("mirrors each hub's primary workbenches exactly", () => {
    const hubs = buildShellHubs({ pathname: "/team", search: "", activeGroupLabel: "Team", isAllowed: allow });
    for (const hub of PRODUCT_HUBS) {
      const row = hubs.find((entry) => entry.label === hub.label);
      expect(row?.tabs.map((tab) => tab.id)).toEqual(hubPrimaryTabs(hub).map((tab) => tab.id));
    }
  });

  it("marks the live tab current, falling back to the hub default", () => {
    const withTab = buildShellHubs({ pathname: "/competition", search: "?tab=scouting", activeGroupLabel: "Competition", isAllowed: allow });
    const competition = withTab.find((hub) => hub.label === "Competition")!;
    expect(competition.active).toBe(true);
    expect(competition.tabs.find((tab) => tab.current)?.id).toBe("scouting");

    const noTab = buildShellHubs({ pathname: "/competition", search: "", activeGroupLabel: "Competition", isAllowed: allow });
    expect(noTab.find((hub) => hub.label === "Competition")!.tabs.find((tab) => tab.current)?.id).toBe("command");
  });

  it("drops hubs and tabs the access filter refuses", () => {
    const hubs = buildShellHubs({
      pathname: "/dashboard",
      search: "",
      isAllowed: (href) => !href.startsWith("/business") && !href.includes("tab=messages"),
    });
    expect(hubs.some((hub) => hub.label === "Business")).toBe(false);
    expect(hubs.find((hub) => hub.label === "Team")!.tabs.some((tab) => tab.id === "messages")).toBe(false);
  });

  it("swaps quick actions between event day and the rest of the season", () => {
    const eventDay = shellQuickActions({ eventLive: true, unreadMessages: 3, isAllowed: allow });
    expect(eventDay.map((row) => row.id)).toEqual(["brief", "scout", "checklist", "notes", "chat"]);
    expect(eventDay[0]?.tone).toBe("primary");
    expect(eventDay.find((row) => row.id === "chat")?.badge).toBe(3);

    const buildSeason = shellQuickActions({ eventLive: false, isAllowed: allow });
    expect(buildSeason.map((row) => row.id)).toEqual(["my-day", "calendar", "chat", "work", "hours"]);
    expect(buildSeason.length).toBeLessThanOrEqual(5);
  });

  it("resolves recents to catalog labels and ignores unknown or refused hrefs", () => {
    const recents = resolveShellRecents(
      ["/competition?tab=alliance-selection-desk&orgId=abc", "/nowhere", "/team?tab=calendar", "/team?tab=calendar"],
      (href) => href !== "/team?tab=calendar",
    );
    expect(recents).toEqual([
      { href: "/competition?tab=alliance-selection-desk", label: "Alliance desk", context: "Competition › Strategy" },
    ]);
  });

  it("strips orgId but keeps the tab and hash", () => {
    expect(stripOrg("/team?orgId=x&tab=messages#thread")).toBe("/team?tab=messages#thread");
    expect(stripOrg("/hours")).toBe("/hours");
  });
});

describe("sidebar quick actions", () => {
  const hubs = buildShellHubs({
    pathname: "/dashboard",
    search: "",
    activeGroupLabel: "Home",
    isAllowed: allow,
  });

  it("drops the ones whose destination is already a visible hub chip", () => {
    const actions = shellQuickActions({ eventLive: false, isAllowed: allow });
    const kept = dedupeSidebarQuickActions(actions, hubs);
    const keptHrefs = kept.map((row) => row.href);

    // Calendar and My work point at the same place as the Team chips of the
    // same name, a few rows below them in the same panel.
    expect(keptHrefs).not.toContain("/team?tab=calendar");
    expect(keptHrefs).not.toContain("/team?tab=todos");
    // My Day and Clock in are not workbench chips, so they stay.
    expect(keptHrefs).toContain("/competition?tab=my-day");
    expect(keptHrefs).toContain("/hours");
  });

  it("keeps a badged action even when its destination is on screen", () => {
    const actions = shellQuickActions({ eventLive: false, unreadMessages: 0, isAllowed: allow });
    const kept = dedupeSidebarQuickActions(actions, hubs).map((row) => row.href);
    // Chat duplicates the Team chip, but carries an unread count the chip
    // cannot show — and it must not appear/disappear as that count changes.
    expect(kept).toContain("/team?tab=messages");
  });

  it("leaves the drawer's full set alone", () => {
    const actions = shellQuickActions({ eventLive: false, isAllowed: allow });
    // The drawer peeks one hub at a time, so nothing is duplicated there.
    expect(dedupeSidebarQuickActions(actions, []).length).toBe(actions.length);
  });
});

describe("hubs whose page already shows their tabs", () => {
  const hubs = buildShellHubs({
    pathname: "/competition",
    search: "",
    activeGroupLabel: "Competition",
    isAllowed: allow,
  });

  it("marks the six workbench hubs, whose pages render the same row", () => {
    for (const label of ["Competition", "Team", "Business", "Build", "AI", "Media"]) {
      const hub = hubs.find((entry) => entry.label === label);
      expect(hub?.tabsShownOnPage, label).toBe(true);
    }
  });

  it("does not mark Logistics, whose page has no workbench bar", () => {
    // /logistics is a plain page, so the sidebar is the only place these four
    // deep links appear — dropping them there would strand them.
    const logistics = hubs.find((entry) => entry.label === "Logistics");
    expect(logistics?.tabsShownOnPage).toBe(false);
    expect(logistics?.tabs.length).toBeGreaterThan(1);
  });

  it("still carries the tabs, so the drawer and peek can render them", () => {
    // The flag says "the page shows these too", not "throw them away" — a
    // non-active hub still peeks its chips open in the sidebar.
    const competition = hubs.find((entry) => entry.label === "Competition");
    expect(competition?.active).toBe(true);
    expect(competition?.tabs.map((tab) => tab.label)).toEqual([
      "Event day",
      "Scouting",
      "Strategy",
      "Pit",
    ]);
  });
});
