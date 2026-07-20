import { describe, expect, it } from "vitest";
import { HELP_ARTICLES, getHelpArticle, helpArticleHref } from "./articles";
import { filterHelpArticles, scoreHelpArticle, searchHelpArticles } from "./search-help";

describe("help articles", () => {
  it("covers the major Soft-UI tutorials", () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(slugs).toEqual([
      "bottom-island",
      "edit-home",
      "scouting-offline",
      "byok-automode",
      "event-day-command",
      "alliance-season",
      "credits-vs-free",
    ]);
  });

  it("never ships DEMO fluff in titles or summaries", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.title).not.toMatch(/\bDEMO\b/);
      expect(article.summary).not.toMatch(/\bDEMO\b/);
      expect(article.relatedHref.startsWith("/")).toBe(true);
    }
  });

  it("resolves slug lookups and deep links", () => {
    expect(getHelpArticle("edit-home")?.title).toMatch(/Edit Home/i);
    expect(helpArticleHref("byok-automode")).toBe("/help/byok-automode");
    expect(getHelpArticle("missing")).toBeUndefined();
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

  it("ignores short queries and scores zero for nonsense", () => {
    expect(searchHelpArticles("a")).toEqual([]);
    expect(scoreHelpArticle(HELP_ARTICLES[0]!, "zzzznotatopic")).toBe(0);
  });

  it("does not flood weak body-only sponsor matches", () => {
    const hits = searchHelpArticles("sponsor");
    expect(hits.every((hit) => hit.score >= 20)).toBe(true);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("filters the hub list without inventing articles", () => {
    expect(filterHelpArticles("").length).toBe(HELP_ARTICLES.length);
    const credits = filterHelpArticles("credits");
    expect(credits.some((a) => a.slug === "credits-vs-free")).toBe(true);
    expect(credits.length).toBeGreaterThan(0);
    expect(credits.length).toBeLessThanOrEqual(HELP_ARTICLES.length);
  });
});
