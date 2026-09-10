import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRICING_CATALOG } from "@vantage/billing/catalog";
import { describe, expect, it } from "vitest";
import { PRODUCT_HUBS, isHubTab } from "../nav/hubs";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  getHelpArticle,
  helpArticleHref,
  helpArticlesByCategory,
  helpCategoryLabel,
  type HelpArticle,
} from "./articles";
import { filterHelpArticles, scoreHelpArticle, searchHelpArticles } from "./search-help";

/** Slugs that were published before the help-centre expansion — never break these links. */
const PRESERVED_SLUGS = [
  "bottom-island",
  "team-invites",
  "edit-home",
  "scouting-offline",
  "byok-automode",
  "event-day-command",
  "alliance-season",
  "credits-vs-free",
  "media-workspace",
  "hub-access",
  "funding-profile",
  "season-finance",
  "bugbot-ultra",
];

function articleText(article: HelpArticle): string {
  return [
    article.title,
    article.summary,
    ...article.keywords,
    ...article.sections.flatMap((section) => [section.heading, ...section.body]),
  ].join("\n");
}

describe("help articles", () => {
  it("keeps every previously published slug so no in-app or external link 404s", () => {
    const slugs = new Set(HELP_ARTICLES.map((a) => a.slug));
    for (const slug of PRESERVED_SLUGS) {
      expect(slugs.has(slug), `missing preserved slug: ${slug}`).toBe(true);
    }
  });

  it("has unique slugs, ids, titles, and summaries", () => {
    for (const field of ["slug", "id", "title", "summary"] as const) {
      const values = HELP_ARTICLES.map((a) => a[field]);
      expect(new Set(values).size, `duplicate ${field}`).toBe(values.length);
    }
  });

  it("gives every article a non-empty title, summary, keywords, and sections", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.title.trim().length, article.slug).toBeGreaterThan(0);
      expect(article.summary.trim().length, article.slug).toBeGreaterThan(0);
      expect(article.keywords.length, article.slug).toBeGreaterThan(0);
      expect(article.sections.length, article.slug).toBeGreaterThan(0);
      for (const section of article.sections) {
        expect(section.heading.trim().length, article.slug).toBeGreaterThan(0);
        expect(section.body.length, article.slug).toBeGreaterThan(0);
      }
    }
  });

  it("assigns every article to a registered category, and leaves no category empty", () => {
    const categoryIds = new Set(HELP_CATEGORIES.map((c) => c.id));
    for (const article of HELP_ARTICLES) {
      expect(categoryIds.has(article.category), `${article.slug} → ${article.category}`).toBe(true);
    }
    for (const category of HELP_CATEGORIES) {
      const count = HELP_ARTICLES.filter((a) => a.category === category.id).length;
      expect(count, `empty category: ${category.id}`).toBeGreaterThan(0);
    }
    expect(helpCategoryLabel("ai-models")).toBe("AI & models");
  });

  it("groups articles by category in registry order with none lost", () => {
    const groups = helpArticlesByCategory();
    expect(groups.length).toBe(HELP_CATEGORIES.length);
    const total = groups.reduce((sum, group) => sum + group.articles.length, 0);
    expect(total).toBe(HELP_ARTICLES.length);
    expect(groups[0]?.category.id).toBe("getting-started");
  });

  it("deep-links every article at a route that actually exists", () => {
    const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../app");
    const dead: string[] = [];
    for (const article of HELP_ARTICLES) {
      expect(article.relatedHref.startsWith("/"), article.slug).toBe(true);
      const route = article.relatedHref.split(/[?#]/)[0]!.replace(/^\/+/, "");
      const page = route ? resolve(appDir, route, "page.tsx") : resolve(appDir, "page.tsx");
      if (!existsSync(page)) dead.push(`${article.slug} → ${article.relatedHref}`);
    }
    expect(dead).toEqual([]);
  });

  it("only deep-links hub tabs that exist in that hub", () => {
    for (const article of HELP_ARTICLES) {
      const [path, query] = article.relatedHref.split("?");
      const hub = PRODUCT_HUBS.find((candidate) => candidate.href === path);
      if (!hub || !query) continue;
      const tab = new URLSearchParams(query).get("tab");
      if (tab) expect(isHubTab(hub, tab), `${article.slug} → ${article.relatedHref}`).toBe(true);
    }
  });

  it("never ships DEMO, PAYG, or BYOK in titles or summaries", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.title).not.toMatch(/\bDEMO\b/);
      expect(article.summary).not.toMatch(/\bDEMO\b/);
      expect(article.title).not.toMatch(/\bPAYG\b/);
      expect(article.summary).not.toMatch(/\bPAYG\b/);
      expect(article.title).not.toMatch(/\bBYOK\b/);
      expect(article.summary).not.toMatch(/\bBYOK\b/);
    }
  });

  it("resolves slug lookups and deep links", () => {
    expect(getHelpArticle("edit-home")?.title).toMatch(/Edit Home/i);
    expect(helpArticleHref("byok-automode")).toBe("/help/byok-automode");
    expect(getHelpArticle("offline-at-events")?.relatedHref).toBe("/competition");
    expect(getHelpArticle("missing")).toBeUndefined();
  });
});

describe("help pricing stays in lockstep with the billing catalog", () => {
  const PLAN_BY_LABEL: Record<string, { monthlyUsd: number; includedAllowanceUsd: number }> = {
    Free: PRICING_CATALOG.free,
    Pro: PRICING_CATALOG.pro,
    "Pro+": PRICING_CATALOG.pro_plus,
    Max: PRICING_CATALOG.max,
  };

  it("never mentions a plan-adjacent dollar figure the catalog does not carry", () => {
    const offenders: string[] = [];
    for (const article of HELP_ARTICLES) {
      const text = articleText(article);
      // A dollar amount within a few words of a plan label must be that plan's
      // real monthly price or hosted allowance. ("Claude Pro/Max" style mentions
      // never sit this close to a dollar figure.)
      const pattern = /\b(Pro\+|Pro|Max|Free)(?!\+)[^.$\n]{0,16}\$(\d+(?:\.\d+)?)/g;
      for (const match of text.matchAll(pattern)) {
        const plan = PLAN_BY_LABEL[match[1]!]!;
        const amount = Number(match[2]);
        const allowed = [plan.monthlyUsd, plan.includedAllowanceUsd];
        if (!allowed.includes(amount)) {
          offenders.push(`${article.slug}: "${match[0]}" (allowed: ${allowed.join(", ")})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never references the retired pre-ladder plans or prices", () => {
    const stale = [
      /\$69\b/,
      /\$109\b/,
      /\$159\b/,
      /\$299\b/,
      /\$549\b/,
      /Individual (Pro|Max|plan)/i,
      /Team (Pro|Max) plan/i,
      /\bAccess plan\b/i,
    ];
    for (const article of HELP_ARTICLES) {
      const text = articleText(article);
      for (const pattern of stale) {
        expect(text, `${article.slug} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("states the full ladder with the catalog's exact numbers", () => {
    const pricing = getHelpArticle("plans-and-pricing");
    expect(pricing).toBeDefined();
    const text = articleText(pricing!);
    expect(text).toContain(`Pro $${PRICING_CATALOG.pro.monthlyUsd}/mo`);
    expect(text).toContain(`Pro+ $${PRICING_CATALOG.pro_plus.monthlyUsd}/mo`);
    expect(text).toContain(`Max $${PRICING_CATALOG.max.monthlyUsd}/mo`);
    expect(text).toContain(`Free $${PRICING_CATALOG.free.monthlyUsd}`);
    expect(text).toContain(`$${PRICING_CATALOG.pro.includedAllowanceUsd}`);
    expect(text).toContain(`$${PRICING_CATALOG.pro_plus.includedAllowanceUsd}`);
    expect(text).toContain(`$${PRICING_CATALOG.max.includedAllowanceUsd}`);
  });
});

describe("help search index", () => {
  it("jumps to island docs from island keywords", () => {
    const hits = searchHelpArticles("bottom island");
    expect(hits[0]?.slug).toBe("bottom-island");
    expect(hits[0]?.href).toBe("/help/bottom-island");
  });

  it("finds BYOK / Automode and Edit Home", () => {
    expect(searchHelpArticles("automode")[0]?.slug).toBe("byok-automode");
    expect(searchHelpArticles("edit home widgets")[0]?.slug).toBe("edit-home");
    expect(searchHelpArticles("offline scouting")[0]?.slug).toBe("scouting-offline");
  });

  it("finds this release's features by the words teams type", () => {
    expect(searchHelpArticles("subscription bridge")[0]?.slug).toBe("ai-bridge");
    expect(searchHelpArticles("team library folders")[0]?.slug).toBe("team-library");
    expect(searchHelpArticles("reimbursement receipt")[0]?.slug).toBe("reimbursements");
    expect(searchHelpArticles("storage node raspberry pi")[0]?.slug).toBe("storage-node");
    expect(searchHelpArticles("agent config cursor")[0]?.slug).toBe("agent-config");
    expect(searchHelpArticles("ollama local model").map((hit) => hit.slug)).toContain("local-ai");
    expect(searchHelpArticles("pricing plans").map((hit) => hit.slug)).toContain(
      "plans-and-pricing",
    );
    expect(searchHelpArticles("my kit")[0]?.slug).toBe("my-kit");
    expect(searchHelpArticles("import notion trello").map((hit) => hit.slug)).toContain("migrate");
    expect(searchHelpArticles("venue wifi")[0]?.slug).toBe("offline-at-events");
    expect(searchHelpArticles("packing list")[0]?.slug).toBe("packing-lists");
    expect(searchHelpArticles("battery logs")[0]?.slug).toBe("batteries-at-events");
    expect(searchHelpArticles("season calendar")[0]?.slug).toBe("season-calendar");
  });

  it("ignores short queries and scores zero for nonsense", () => {
    expect(searchHelpArticles("a")).toEqual([]);
    expect(scoreHelpArticle(HELP_ARTICLES[0]!, "zzzznotatopic")).toBe(0);
  });

  it("keeps weak body-only matches out of Cmd+K", () => {
    const hits = searchHelpArticles("sponsor");
    expect(hits.every((hit) => hit.score >= 20)).toBe(true);
  });

  it("finds hub access, funding profile, and the finance desk", () => {
    expect(searchHelpArticles("hub access")[0]?.slug).toBe("hub-access");
    expect(searchHelpArticles("funding profile affiliation")[0]?.slug).toBe("funding-profile");
    expect(searchHelpArticles("purchase log")[0]?.slug).toBe("season-finance");
  });

  it("filters the hub list without inventing articles", () => {
    expect(filterHelpArticles("").length).toBe(HELP_ARTICLES.length);
    const credits = filterHelpArticles("credits");
    expect(credits.some((a) => a.slug === "credits-vs-free")).toBe(true);
    expect(credits.length).toBeGreaterThan(0);
    expect(credits.length).toBeLessThanOrEqual(HELP_ARTICLES.length);
  });
});
