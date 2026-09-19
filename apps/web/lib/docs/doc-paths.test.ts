import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_HUB_REDIRECTS } from "../nav/legacy-redirects";
import { getHelpArticle } from "../help/articles";

/**
 * The manuals have to describe *this* app.
 *
 * `SEASON_WORKFLOW.md` tells a team where each job of the season lives, and it
 * does it with roughly a hundred literal paths — `/hours`, `/team/profile`,
 * `/inventory`. Those are the first thing a new member follows, and a route
 * that has been renamed, folded into a hub tab or deleted turns the manual
 * into a list of 404s without anything failing. Documentation drifts silently;
 * that is the whole problem with it.
 *
 * So every path these files promise is checked against the routes that exist.
 * The check is deliberately cheap — filesystem, no server — so it runs with
 * the unit tests rather than needing a browser.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const REPO_ROOT = join(WEB_ROOT, "..", "..");
const APP_DIR = join(WEB_ROOT, "app");

/** Every path the App Router serves a page for. */
function routesWithPages(): Set<string> {
  const routes = new Set<string>();
  if (existsSync(join(APP_DIR, "page.tsx"))) routes.add("/");

  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      // `api` holds route handlers, not pages; `_`-prefixed folders are
      // private; `(group)` folders do not appear in the URL.
      if (entry.startsWith("_")) continue;
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (entry === "api") continue;
      const path = entry.startsWith("(") ? prefix : `${prefix}/${entry}`;
      if (existsSync(join(full, "page.tsx"))) routes.add(path || "/");
      walk(full, path);
    }
  };
  walk(APP_DIR, "");
  return routes;
}

/** Route handlers — documented as endpoints, not pages. */
function apiRoutes(): Set<string> {
  const routes = new Set<string>();
  const apiDir = join(APP_DIR, "api");
  if (!existsSync(apiDir)) return routes;
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      const path = `${prefix}/${entry}`;
      if (existsSync(join(full, "route.ts"))) routes.add(path);
      walk(full, path);
    }
  };
  walk(apiDir, "/api");
  return routes;
}

const PAGES = routesWithPages();
const API = apiRoutes();
const REDIRECTS = new Set(LEGACY_HUB_REDIRECTS.map((entry) => entry.source));

/**
 * Does the app serve this path?
 *
 * A route folder named `[slug]` matches any single segment, so the manual's
 * concrete `/help/ai-bridge` has to be matched against the pattern
 * `/help/[slug]` rather than compared as a string. Two earlier versions of
 * this got it wrong in opposite directions: the first accepted any path whose
 * parent was a route, and since `/` is a route that accepted everything
 * including `/definitely-not-a-page`; the second accepted only literals, and
 * called four real help articles dead. A check that cannot fail and a check
 * that cries wolf are equally useless.
 *
 * `/help/<slug>` gets a stronger check than pattern matching, because that is
 * where the manuals point most often: the slug has to be a real article.
 * Otherwise `/help/total-nonsense` would satisfy `/help/[slug]` forever.
 */
function matchesPattern(pattern: string, path: string): boolean {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => {
    if (part.startsWith("[") && part.endsWith("]")) return Boolean(pathParts[index]);
    return part === pathParts[index];
  });
}

function resolves(path: string): boolean {
  const clean = (path.split(/[?#]/)[0] ?? path).replace(/\/+$/, "") || "/";
  if (PAGES.has(clean) || API.has(clean) || REDIRECTS.has(clean)) return true;

  // A help article is only documented correctly if it actually exists.
  const help = /^\/help\/([A-Za-z0-9-]+)$/.exec(clean);
  if (help) return Boolean(getHelpArticle(help[1] as string));

  for (const route of [...PAGES, ...API]) {
    if (route.includes("[") && matchesPattern(route, clean)) return true;
  }
  return false;
}

/** Paths written as `code` in the prose — the form the manuals use. */
function documentedPaths(file: string): string[] {
  const text = readFileSync(join(REPO_ROOT, file), "utf8");
  const found = new Set<string>();
  for (const match of text.matchAll(/`(\/[A-Za-z0-9\-/[\]:?=&#]*)`/g)) {
    const path = match[1];
    if (!path || path === "/") continue;
    // Not a URL: file paths and globs also live in backticks.
    if (/\.(tsx?|css|sql|mjs|json|md)$/.test(path)) continue;
    if (path.includes("*")) continue;
    found.add(path);
  }
  return [...found].sort();
}

/**
 * The files that send people to specific screens. `WHAT_IS_VANTAGE.md` is
 * deliberately not here: it is a plain-language tour that names no paths at
 * all, so checking it would only ever assert that it still contains nothing.
 */
const MANUALS = ["docs/SEASON_WORKFLOW.md", "docs/FEATURE_MAP.md", "README.md"];

describe("the manuals point at pages that exist", () => {
  it("found the app's routes at all", () => {
    // Guards the guard: an empty route set would pass every check below while
    // proving nothing.
    expect(PAGES.size).toBeGreaterThan(100);
    expect(API.size).toBeGreaterThan(50);
    expect(PAGES.has("/dashboard")).toBe(true);
    expect(PAGES.has("/calendar")).toBe(true);
  });

  for (const manual of MANUALS) {
    it(`${manual} has no dead paths`, () => {
      const paths = documentedPaths(manual);
      expect(paths.length).toBeGreaterThan(0);
      const dead = paths.filter((path) => !resolves(path));
      expect(
        dead,
        `${manual} promises ${dead.length} path(s) with no page, API route or redirect: ${dead.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("counts a legacy path as documented only while the redirect is real", () => {
    // FEATURE_MAP says Logistics is "also /travel" and CAD is "also /cad".
    // Both are redirects rather than pages, and if either is ever dropped the
    // manual would be sending people nowhere.
    expect(resolves("/travel")).toBe(true);
    expect(resolves("/cad")).toBe(true);
    expect(REDIRECTS.has("/travel")).toBe(true);
    expect(REDIRECTS.has("/cad")).toBe(true);
  });

  it("does not quietly accept a path that is not there", () => {
    expect(resolves("/definitely-not-a-page")).toBe(false);
    expect(resolves("/team/not-a-real-tab-either")).toBe(false);
  });

  it("checks a help slug against the articles, not just the [slug] route", () => {
    // /help/[slug] matches any word, so pattern matching alone would bless a
    // link to an article nobody wrote.
    expect(resolves("/help/season-calendar")).toBe(true);
    expect(resolves("/help/an-article-nobody-wrote")).toBe(false);
  });
});
