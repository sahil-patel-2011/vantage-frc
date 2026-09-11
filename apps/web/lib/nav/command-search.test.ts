import { describe, expect, it } from "vitest";
import { commandCatalog, searchCommands, type CommandEntry } from "./command-search";

const catalog = commandCatalog();
const top = (query: string, count = 1): string[] =>
  searchCommands(query, catalog).slice(0, count).map((hit) => hit.label);
const hrefs = (query: string, count = 5): string[] =>
  searchCommands(query, catalog).slice(0, count).map((hit) => hit.href);

describe("commandCatalog", () => {
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
    const coverage = catalog.find((entry) => entry.href === "/competition?tab=scout-coverage-live");
    expect(coverage?.label).toBe("Coverage");
    expect(coverage?.context).toBe("Competition › Scouting");
  });

  it("lists Media library so search opens a real destination", () => {
    const library = catalog.find((entry) => entry.id === "media:media-library");
    expect(library?.href).toBe("/media?tab=media-library");
    expect(hrefs("media library")).toContain("/media?tab=media-library");
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
    expect(hrefs("asd")).toContain("/competition?tab=alliance-selection-desk");
  });

  it("tolerates a query that spans label and hub context", () => {
    expect(hrefs("scouting coverage")).toContain("/competition?tab=scout-coverage-live");
    expect(hrefs("scout shifts")).toContain("/competition?tab=shift-balancer");
  });

  it("survives a dropped letter via subsequence matching", () => {
    expect(hrefs("clendar")).toContain("/team?tab=calendar");
    expect(hrefs("season calendar")).toContain("/calendar");
    expect(hrefs("this phone")).toContain("/team?tab=offline-shell");
    expect(hrefs("chat limits")).toContain("/ai?tab=budgets");
    expect(hrefs("btteries", 8)).toContain("/team?tab=batteries");
  });

  it("is case and punctuation insensitive", () => {
    expect(top("PICK CLOCK")).toEqual(top("pick clock"));
    expect(hrefs("pick-list")).toEqual(hrefs("pick list"));
  });

  it("ranks the verb above the destination for action phrasing", () => {
    const first = searchCommands("clock in", catalog)[0];
    expect(first?.kind).toBe("action");
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
    expect(hrefs("robot failed", 8)).toContain("/build?tab=failure-patterns");
  });

  it("ignores filler words in a natural-language query", () => {
    expect(hrefs("how do i log my hours", 8)).toContain("/hours-self-view");
    expect(hrefs("what is the budget", 8)).toContain("/business?tab=budget");
  });

  it("still ranks a full-word match above a partial one", () => {
    const results = searchCommands("scout shifts", catalog);
    expect(results[0]?.href).toBe("/competition?tab=shift-balancer");
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
    ["brownout", "/build?tab=power-budget"],
    ["gear ratio", "/build?tab=gearbox"],
    ["can bus", "/build?tab=wiring-map"],
    ["zip ties", "/build?tab=consumables"],
    ["how heavy", "/build?tab=weight-budget"],
    ["first power", "/build?tab=bringup"],
    ["when do we play", "/competition?tab=schedule"],
    ["injury", "/team?tab=safety"],
    ["engineering notebook", "/team?tab=notebook"],
    ["where to buy", "/business?tab=vendors"],
    // The rookie-survival roadmap, found by the words a first-year coach types.
    ["rookie", "/team?tab=roadmap"],
    ["first season", "/team?tab=roadmap"],
    ["what do we do next", "/team?tab=roadmap"],
    ["getting started", "/team?tab=roadmap"],
    ["season checklist", "/team?tab=roadmap"],
  ];
  for (const [query, href] of cases) {
    it(`finds ${href} from "${query}"`, () => {
      expect(hrefs(query, 6)).toContain(href);
    });
  }
});

describe("this wave's tools are findable by the words teams type", () => {
  const cases: Array<[string, string]> = [
    ["guardians", "/team?tab=parents"],
    ["parent email", "/team?tab=parents"],
    ["newsletter", "/team?tab=parents"],
    ["successor", "/team?tab=leadership"],
    ["who is next", "/team?tab=leadership"],
    ["roll call", "/team?tab=presence"],
    ["rsvp", "/team?tab=presence"],
    ["who is struggling", "/team?tab=learning"],
    ["call your shot", "/team?tab=learning"],
    ["write it up", "/team?tab=knowledge-drafts"],
    ["wiki drafts", "/team?tab=knowledge-drafts"],
    ["needs cam", "/build?tab=manufacturing"],
    ["parts board", "/build?tab=manufacturing"],
    ["filament", "/build?tab=print-farm"],
    ["3d print", "/build?tab=print-farm"],
    ["petg", "/build?tab=print-farm"],
    ["stl", "/build?tab=cad-vault"],
    ["dxf", "/build?tab=cad-vault"],
    ["upload cad", "/build?tab=cad-vault"],
    ["inspection prep", "/competition?tab=event-readiness"],
    ["consent", "/competition?tab=event-readiness"],
    ["pre event", "/competition?tab=event-readiness"],
  ];
  for (const [query, href] of cases) {
    it(`finds ${href} from "${query}"`, () => {
      expect(hrefs(query, 6)).toContain(href);
    });
  }
});
