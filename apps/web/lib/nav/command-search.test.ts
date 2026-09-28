import { describe, expect, it } from "vitest";
import { MEDIA_ENABLED } from "../media-availability";
import { commandCatalog, isTeamAdminCommand, searchCommands, type CommandEntry } from "./command-search";

const catalog = commandCatalog();
const top = (query: string, count = 1): string[] =>
  searchCommands(query, catalog).slice(0, count).map((hit) => hit.label);
const hrefs = (query: string, count = 5): string[] =>
  searchCommands(query, catalog).slice(0, count).map((hit) => hit.href);

describe("commandCatalog", () => {
  it("opens travel inside Team, and duties and visit invites on their own pages", () => {
    expect(catalog.filter((entry) => entry.href === "/team?tab=logistics")).toHaveLength(1);
    expect(catalog.some((entry) => entry.href === "/logistics")).toBe(false);
    expect(catalog.filter((entry) => entry.href === "/duties")).toHaveLength(1);
    expect(catalog.filter((entry) => entry.href === "/visit-invites")).toHaveLength(1);
    expect(catalog.some((entry) => entry.href === "/team?tab=duties")).toBe(false);
    expect(catalog.some((entry) => entry.href === "/team?tab=visit-invites")).toBe(false);
    expect(hrefs("hotel")).toContain("/team?tab=logistics");
  });
  it("covers every hub tab plus actions and standalone destinations", () => {
    expect(catalog.length).toBeGreaterThan(120);
    expect(catalog.some((entry) => entry.kind === "action")).toBe(true);
    expect(catalog.some((entry) => entry.href === "/dashboard")).toBe(true);
  });

  it("never emits duplicate destinations", () => {
    const seen = new Set<string>();
    for (const entry of catalog) {
      expect(seen.has(entry.href)).toBe(false);
      seen.add(entry.href);
    }
  });

  it("gives nested tabs a hub breadcrumb so labels are unambiguous", () => {
    const coverage = catalog.find((entry) => entry.href === "/scout-coverage-live");
    expect(coverage?.label).toBe("Coverage");
    expect(coverage?.context).toBe("Competition › Scout");
  });

  it.skipIf(!MEDIA_ENABLED)("lists Media library so search opens a real destination", () => {
    const library = catalog.find((entry) => entry.id === "media:media-library");
    expect(library?.href).toBe("/media-library");
    expect(hrefs("media library")).toContain("/media-library");
  });

  it("keeps every entry pointing at a real in-app path", () => {
    for (const entry of catalog) {
      expect(entry.href.startsWith("/")).toBe(true);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});

describe("searchCommands ranking", () => {
  it("puts an exact label match first", () => {
    expect(top("Calendar")).toEqual(["Calendar"]);
    expect(top("Kickoff")).toEqual(["Kickoff"]);
  });

  it("finds tools by the words teams actually use, not the label", () => {
    // None of these words appear in the tab labels they must return.
    expect(hrefs("bumpers")).toContain("/competition?tab=match-checklist");
    expect(hrefs("onshape")).toContain("/build?tab=cad");
    expect(hrefs("wpilib")).toContain("/build?tab=code");
    expect(hrefs("clock in")).toContain("/hours-self-view");
    expect(hrefs("dark mode")).toContain("/account?tab=appearance");
    expect(hrefs("who is coming")).toContain("/team?tab=attendance");
  });

  it("matches word-initial abbreviations", () => {
    expect(hrefs("asd")).toContain("/alliance-selection-desk");
  });

  it("tolerates a query that spans label and hub context", () => {
    expect(hrefs("scouting coverage")).toContain("/scout-coverage-live");
    expect(hrefs("scout shifts")).toContain("/shift-balancer");
  });

  it("survives a dropped letter via subsequence matching", () => {
    expect(hrefs("clendar")).toContain("/team?tab=calendar");
    expect(hrefs("season calendar")).toContain("/calendar");
    expect(hrefs("this phone")).toContain("/offline-shell");
    expect(hrefs("chat limits")).toContain("/ai?tab=budgets");
    expect(hrefs("btteries", 8)).toContain("/team?tab=batteries");
  });

  it("is case and punctuation insensitive", () => {
    expect(top("PICK CLOCK")).toEqual(top("pick clock"));
    expect(hrefs("pick-list")).toEqual(hrefs("pick list"));
  });

  it("opens My hours for clock-in phrasing", () => {
    const first = searchCommands("clock in", catalog)[0];
    expect(first?.href).toBe("/hours-self-view");
  });

  it("returns nothing for a query that matches no tool", () => {
    expect(searchCommands("zzzzqqqq", catalog)).toEqual([]);
  });

  it("honours the result limit", () => {
    expect(searchCommands("a", catalog, { limit: 3 })).toHaveLength(3);
  });
});

describe("searchCommands gating and empty state", () => {
  it("hides destinations the member may not open", () => {
    const results = searchCommands("budget", catalog, {
      isAllowed: (href) => !href.startsWith("/business"),
    });
    expect(results.every((hit) => !hit.href.startsWith("/business"))).toBe(true);
  });

  it("shows recents first when the query is empty", () => {
    const results = searchCommands("", catalog, {
      recentHrefs: ["/build?tab=cad", "/team?tab=messages"],
      limit: 5,
    });
    expect(results.slice(0, 2).map((hit) => hit.href)).toEqual([
      "/build?tab=cad",
      "/team?tab=messages",
    ]);
  });

  it("falls back to featured entries with no recents", () => {
    const results = searchCommands("", catalog, { limit: 6 });
    expect(results.length).toBe(6);
    expect(results.every((hit) => hit.featured)).toBe(true);
  });

  it("ignores a recent href the member can no longer reach", () => {
    const results = searchCommands("", catalog, {
      recentHrefs: ["/business?tab=budget"],
      isAllowed: (href) => !href.startsWith("/business"),
      limit: 4,
    });
    expect(results.every((hit) => !hit.href.startsWith("/business"))).toBe(true);
  });

  it("does not repeat a recent that is also featured", () => {
    const results = searchCommands("", catalog, { recentHrefs: ["/dashboard"], limit: 8 });
    expect(results.filter((hit) => hit.href === "/dashboard")).toHaveLength(1);
  });

  it("hides Team admin and Invite a teammate when the member cannot manage the team", () => {
    const invited = searchCommands("invite", catalog, { canManageTeam: false, limit: 12 });
    expect(invited.some((hit) => isTeamAdminCommand(hit.href))).toBe(false);
    const named = searchCommands("team admin", catalog, { canManageTeam: false, limit: 12 });
    expect(named.some((hit) => isTeamAdminCommand(hit.href))).toBe(false);
    const empty = searchCommands("", catalog, { canManageTeam: false, limit: 24 });
    expect(empty.some((hit) => isTeamAdminCommand(hit.href))).toBe(false);
  });

  it("keeps Team admin when manage access is omitted", () => {
    expect(hrefs("team admin")).toContain("/team/admin");
    expect(searchCommands("invite a teammate", catalog).some((hit) => hit.href.startsWith("/team/admin"))).toBe(true);
  });
});

describe("searchCommands with a custom catalog", () => {
  const custom: CommandEntry[] = [
    { id: "a", label: "Alpha", context: "Test", href: "/alpha", kind: "destination", keywords: ["first"] },
    { id: "b", label: "Beta", context: "Test", href: "/beta", kind: "destination", keywords: [] },
  ];

  it("searches only the entries it is given", () => {
    expect(searchCommands("first", custom).map((hit) => hit.href)).toEqual(["/alpha"]);
    expect(searchCommands("calendar", custom)).toEqual([]);
  });
});

describe("searchCommands multi-word and stemming (audit regressions)", () => {
  it("reaches a tool whose label uses a different word form", () => {
    // "failed" vs the label "Failure patterns"
    expect(hrefs("robot failed", 8)).toContain("/failure-patterns");
  });

  it("ignores filler words in a natural-language query", () => {
    expect(hrefs("how do i log my hours", 8)).toContain("/hours-self-view");
    expect(hrefs("what is the budget", 8)).toContain("/business?tab=budget");
  });

  it("still ranks a full-word match above a partial one", () => {
    const results = searchCommands("scout shifts", catalog);
    expect(results[0]?.href).toBe("/shift-balancer");
  });

  it("spreads the empty state across hubs instead of one hub", () => {
    const results = searchCommands("", catalog, { limit: 10 });
    const workspaces = new Set(results.map((hit) => hit.context.split("›")[0]!.trim()));
    expect(workspaces.size).toBeGreaterThanOrEqual(4);
    expect(workspaces.has("Build")).toBe(true);
    expect(workspaces.has("Business")).toBe(true);
  });

  it("keeps recents ahead of the round-robin", () => {
    const results = searchCommands("", catalog, { recentHrefs: ["/build?tab=cad"], limit: 6 });
    expect(results[0]?.href).toBe("/build?tab=cad");
  });
});

describe("newly surfaced tools are findable by their real-world words", () => {
  const cases: Array<[string, string]> = [
    ["brownout", "/power-budget"],
    ["gear ratio", "/gearbox"],
    ["can bus", "/wiring"],
    ["zip ties", "/spares"],
    ["how heavy", "/weight-budget"],
    ["first power", "/bringup"],
    ["when do we play", "/schedule"],
    ["injury", "/safety"],
    ["engineering notebook", "/notebook"],
    ["where to buy", "/vendors"],
    // The rookie-survival roadmap, found by the words a first-year coach types.
    ["rookie", "/roadmap"],
    ["first season", "/roadmap"],
    ["what do we do next", "/roadmap"],
    ["getting started", "/roadmap"],
    ["season checklist", "/roadmap"],
  ];
  for (const [query, href] of cases) {
    it(`finds ${href} from "${query}"`, () => {
      expect(hrefs(query, 6)).toContain(href);
    });
  }
});

describe("this wave's tools are findable by the words teams type", () => {
  const cases: Array<[string, string]> = [
    ["guardians", "/parents"],
    ["parent email", "/parents"],
    ["newsletter", "/parents"],
    ["successor", "/leadership"],
    ["who is next", "/leadership"],
    ["roll call", "/presence"],
    ["rsvp", "/presence"],
    ["who is struggling", "/learning"],
    ["call your shot", "/learning"],
    ["write it up", "/knowledge-drafts"],
    ["wiki drafts", "/knowledge-drafts"],
    ["needs cam", "/manufacturing"],
    ["parts board", "/manufacturing"],
    ["filament", "/print-farm"],
    ["3d print", "/print-farm"],
    ["petg", "/print-farm"],
    ["stl", "/cad-vault"],
    ["dxf", "/cad-vault"],
    ["upload cad", "/cad-vault"],
    ["inspection prep", "/event-readiness"],
    ["consent", "/event-readiness"],
    ["pre event", "/event-readiness"],
  ];
  for (const [query, href] of cases) {
    it(`finds ${href} from "${query}"`, () => {
      expect(hrefs(query, 6)).toContain(href);
    });
  }
});
