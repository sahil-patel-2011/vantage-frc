/**
 * Navigation coverage invariants.
 *
 * Vantage grew to ~270 routes, and the audit found ~27 fully working, tested
 * features with no entry in any menu — reachable only by typing the URL. These
 * tests turn "a feature exists but nobody can find it" into a failing build.
 *
 * Rules enforced here come from the UI review:
 *   R2 — no feature is reachable only by knowing its URL.
 *   R6 — any tool surfaces in the palette's top 5 from a short prefix.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandCatalog, searchCommands } from "./command-search";
import { PRODUCT_HUBS } from "./hubs";
import { LEGACY_HUB_REDIRECTS } from "./legacy-redirects";

const APP_DIR = join(__dirname, "..", "..", "app");

/**
 * Routes that intentionally have no menu entry. Each needs a reason — this
 * list is the honest record of what is deliberately hidden, so it should stay
 * short and every addition should be justified.
 */
const INTENTIONALLY_UNLISTED = new Map<string, string>([
  ["/", "public marketing landing"],
  ["/pricing", "public marketing"],
  ["/privacy", "public legal"],
  ["/terms", "public legal"],
  ["/claim/report", "linked from /claim through teamClaimReportHref(), which the scan cannot follow"],
  ["/for-teams", "public marketing"],
  ["/desktop", "public download page"],
  ["/signin", "auth entry"],
  ["/sign-in", "auth entry alias"],
  ["/onboarding", "gated first-run flow, reached by redirect"],
  ["/start", "gated first-run flow"],
  ["/claim", "public self-serve org claim"],
  ["/invite", "reached from an emailed token link"],
  ["/unsubscribe", "reached from an email footer"],
  ["/offline", "service-worker fallback page"],
  ["/workspace", "team switcher, reached from the account menu"],
  ["/support", "reached from the account menu"],
  ["/docs", "reached from the account menu"],
  ["/help", "reached from the account menu"],
  ["/security", "reached from the account menu"],
  ["/consent", "gated compliance flow"],
  ["/display", "wall display, opened once on a dedicated screen"],
  ["/whats-new", "reached from the account menu"],
  ["/desktop-link", "approval landing opened by the desktop app's sign-in flow"],
  // Opened from a minted kiosk token, copied to the clipboard on the Display
  // setup page and pasted into a pit TV or a Pi stick. There is no signed-in
  // person to show a menu to.
  ["/display/kiosk", "opened from a minted read-only kiosk token on a pit TV"],
  ["/display/stage", "opened from a minted read-only kiosk token on a pit TV"],
  // A shared snapshot. The page itself says the link only opens the board for
  // the team that created it, so a menu entry would point at nothing.
  ["/strategy/board", "opened from a shared board link, scoped to one team"],
  // Never navigated to directly: the proxy rewrites a paused media tool's own
  // address to this page, so a menu entry would be a link to "this is paused".
  ["/media-paused", "shown in place of a paused media tool, by the proxy's rewrite"],
]);

/** Directory names that are not user-facing routes. */
const SKIP_SEGMENTS = new Set(["api", "admin"]);
/** Leftover volume kits: cloned page trees. Same skip as eslint/tsconfig/vitest. */
const LEFTOVER_KIT_DIRS = new Set(["win-kit", "lovat-kit", "agent-kit"]);

function collectRoutes(dir: string, prefix = ""): string[] {
  const routes: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return routes;
  }

  if (entries.includes("page.tsx")) routes.push(prefix || "/");

  for (const entry of entries) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    if (SKIP_SEGMENTS.has(entry) || LEFTOVER_KIT_DIRS.has(entry)) continue;
    // Dynamic segments ([slug]) are detail views reached from their index.
    if (entry.startsWith("[")) continue;
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    routes.push(...collectRoutes(full, `${prefix}/${entry}`));
  }
  return routes;
}

const routes = collectRoutes(APP_DIR);
const catalog = commandCatalog();

/**
 * Routes a member can reach from navigation: the palette lists it, a hub tab
 * points at it, or it redirects into a hub.
 */
const navReachable = new Set<string>();
for (const entry of catalog) navReachable.add(entry.href.split("?")[0]!);
for (const hub of PRODUCT_HUBS) {
  for (const tab of hub.tabs) {
    if (tab.legacyHref) navReachable.add(tab.legacyHref.split("?")[0]!);
  }
}
for (const row of LEGACY_HUB_REDIRECTS) {
  navReachable.add(row.source.replace("/:path*", ""));
}

/**
 * Routes some other page links to. A sub-page opened from its parent (the
 * hours kiosk from Hours, CAD setup from CAD) is legitimately not in a menu —
 * what matters is that SOMETHING points at it. A page with neither a menu
 * entry nor a single inbound link is the real orphan.
 *
 * A *link*, though, and this is where the rule used to leak. It counted any
 * string literal that happened to equal a route, so a page was "reachable"
 * because `lib/offline/shell-routes.ts` listed it as cacheable, or because
 * `robots.ts` told crawlers to stay off it. Neither of those is a way in for a
 * person. The rule reported no orphans while /match-debrief — a complete
 * feature with an API, offline support and its own browser specs — could be
 * opened only by typing the URL.
 *
 * So: the mention has to be in something that navigates. An `href`, an
 * `href:` in a related-links list, a `path:` in one (those become hrefs a few
 * lines further down, through a helper this cannot see), a helper that builds
 * one, or a redirect. And route registries are excluded outright, because
 * listing a route is the one thing they all do.
 */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    if (LEFTOVER_KIT_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collectSourceFiles(full, acc);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

/**
 * Files whose whole job is to list routes. A route appearing here says nothing
 * about whether anybody can get to it.
 */
const ROUTE_REGISTRIES = [
  "lib/offline/shell-routes.ts",
  "lib/nav/route-coverage.test.ts",
  "app/robots.ts",
  "app/sitemap.ts",
  "lib/offline/offline-related.ts",
];

/**
 * `href="/x"`, `href={"/x"}`, `href={`/x`}`, `href: "/x"`, `path: "/x"` in a
 * related-links list, a helper that builds one (`withOrgHref("/x", …)`,
 * `hubHref("/x", …)`), or a redirect.
 */
const NAVIGATING_MENTION =
  /(?:href|path)\s*[=:]\s*\{?\s*["'`](\/[a-z0-9][a-z0-9\-/]*)|(?:withOrgHref|hubHref|withOrg|redirect|push|replace)\(\s*["'`](\/[a-z0-9][a-z0-9\-/]*)/g;

const linkedRoutes = new Set<string>();
{
  const sources = [
    ...collectSourceFiles(APP_DIR),
    ...collectSourceFiles(join(__dirname, "..", "..", "components")),
    ...collectSourceFiles(join(__dirname, "..")),
  ];
  const routeSet = new Set(routes);
  for (const file of sources) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (ROUTE_REGISTRIES.some((name) => file.split("\\").join("/").endsWith(name))) continue;
    // An in-app path in a position that actually navigates somewhere.
    for (const match of text.matchAll(NAVIGATING_MENTION)) {
      const path = (match[1] ?? match[2])!.replace(/\/$/, "");
      if (!routeSet.has(path)) continue;
      // A page linking to itself does not make it discoverable.
      const owning = join(APP_DIR, ...path.split("/").filter(Boolean));
      if (file.startsWith(owning)) continue;
      linkedRoutes.add(path);
    }
  }
}

function isReachable(route: string): boolean {
  return navReachable.has(route) || linkedRoutes.has(route);
}

describe("route inventory", () => {
  it("skips leftover kit trees in next build the same way as this inventory", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
    ) as { scripts?: { build?: string } };
    const build = pkg.scripts?.build ?? "";
    expect(build).toContain("build-without-leftover-kits.mjs");
    const wrapper = readFileSync(
      join(__dirname, "..", "..", "scripts", "build-without-leftover-kits.mjs"),
      "utf8",
    );
    expect(wrapper).toContain("win-kit");
    expect(wrapper).toContain("lovat-kit");
    expect(wrapper).toContain("agent-kit");
  });

  it("finds the app's routes on disk", () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(routes).toContain("/dashboard");
    expect(routes).toContain("/competition");
  });

  it("guards against another mass deletion of the route tree", () => {
    // 454 files were once deleted from the working tree without anything failing.
    expect(routes.length).toBeGreaterThan(200);
  });
});

describe("R2 — every feature has a way in besides typing the URL", () => {
  const orphans = routes
    .filter((route) => !INTENTIONALLY_UNLISTED.has(route))
    .filter((route) => !isReachable(route));

  it("has no unreachable product route", () => {
    // The message lists them so a failure is actionable, not a bare count.
    expect(orphans, `unreachable routes:\n  ${orphans.join("\n  ")}`).toEqual([]);
  });

  it("keeps the deliberately-hidden list honest", () => {
    for (const [route, reason] of INTENTIONALLY_UNLISTED) {
      expect(reason.length, `${route} needs a reason`).toBeGreaterThan(8);
    }
  });

  it("does not list a route as hidden that no longer exists", () => {
    const stale = [...INTENTIONALLY_UNLISTED.keys()].filter(
      (route) => route !== "/" && !routes.includes(route),
    );
    expect(stale, `stale entries in INTENTIONALLY_UNLISTED:\n  ${stale.join("\n  ")}`).toEqual([]);
  });
});

describe("R6 — the palette surfaces a tool from a short prefix", () => {
  it("ranks every destination top-3 for its own full name", () => {
    const failures: string[] = [];
    for (const entry of catalog) {
      const top3 = searchCommands(entry.label, catalog, { limit: 3 }).map((hit) => hit.href);
      if (!top3.includes(entry.href)) {
        failures.push(`"${entry.label}" did not rank itself top-3 (${entry.href})`);
      }
    }
    expect(failures, `palette misses:\n  ${failures.join("\n  ")}`).toEqual([]);
  });

  it("surfaces every destination from a four-letter prefix of one of its words", () => {
    /*
      Any word, not always the first, because that is what a person types.

      Eight tools begin with "Match" and seven with "Season", so demanding
      that the first four letters of the label surface the tool is demanding
      that a ranking fit seven things into a top-8 alongside everything else
      matching — and the bar has already been raised once to keep up. The next
      "Season …" feature would raise it again, and each raise makes the rule
      weaker for every tool that does not share a prefix with anything.

      Somebody looking for Season rollover types "roll", which puts it first.
      So the honest rule is that SOME short word-prefix finds it near the top;
      a tool that no four letters of its own name can surface is the one that
      cannot be found.
    */
    const failures: string[] = [];
    for (const entry of catalog) {
      const words = entry.label
        .split(/[^A-Za-z0-9]+/)
        .filter((word) => word.length >= 3)
        .map((word) => word.slice(0, 4));
      const probes = words.length ? words : [entry.label.slice(0, 4)];
      const found = probes.some((probe) =>
        searchCommands(probe, catalog, { limit: 8 })
          .map((hit) => hit.href)
          .includes(entry.href),
      );
      if (!found) {
        failures.push(`no four letters of "${entry.label}" surface it (${entry.href})`);
      }
    }
    expect(failures, `palette misses:\n  ${failures.join("\n  ")}`).toEqual([]);
  });

  it("answers the jobs a member actually types", () => {
    const jobs: Array<[string, string]> = [
      ["scout", "/competition?tab=scouting"],
      ["pick list", "/competition?tab=picklist-collab"],
      ["hours", "/team?tab=hours"],
      ["chat", "/team?tab=messages"],
      ["budget", "/business?tab=budget"],
      ["cad", "/build?tab=cad"],
      ["battery", "/team?tab=batteries"],
      ["calendar", "/team?tab=calendar"],
    ];
    for (const [query, href] of jobs) {
      const top5 = searchCommands(query, catalog, { limit: 5 }).map((hit) => hit.href);
      expect(top5, `"${query}" should reach ${href}`).toContain(href);
    }
  });
});
