import { describe, expect, it } from "vitest";
import { HELP_ARTICLES, HELP_CATEGORIES } from "./articles";
import {
  HELP_TOPICS,
  POPULAR_HELP_SLUGS,
  helpTopicArticles,
  helpTopicFor,
  isHelpTopicId,
  popularHelpArticles,
  searchHelpCenter,
} from "./topics";

describe("Help center topics", () => {
  it("are seven calm cards instead of thirteen chips, with no Billing & plans", () => {
    expect(HELP_TOPICS.length).toBeGreaterThanOrEqual(6);
    expect(HELP_TOPICS.length).toBeLessThanOrEqual(8);
    expect(HELP_TOPICS.map((topic) => topic.label).join(" ")).not.toMatch(/billing|plans|pricing/i);
    for (const topic of HELP_TOPICS) {
      expect(topic.blurb.length).toBeGreaterThan(10);
      expect(helpTopicArticles(topic.id).length).toBeGreaterThan(0);
    }
  });

  it("file every article under exactly one topic, so nothing drops out of the Help center", () => {
    const covered = HELP_TOPICS.flatMap((topic) => topic.categories);
    expect(new Set(covered).size).toBe(covered.length);
    for (const category of HELP_CATEGORIES) expect(covered).toContain(category.id);
    const total = HELP_TOPICS.reduce((sum, topic) => sum + helpTopicArticles(topic.id).length, 0);
    expect(total).toBe(HELP_ARTICLES.length);
    // What Vantage costs (free) and AI spend limits are about AI keys.
    expect(helpTopicFor(HELP_ARTICLES.find((article) => article.slug === "credits-vs-free")!).id).toBe("ai");
  });

  it("popular articles are real articles, chosen by hand", () => {
    expect(popularHelpArticles().map((article) => article.slug)).toEqual([...POPULAR_HELP_SLUGS]);
  });

  it("search waits for two letters, then finds by the words people type", () => {
    expect(searchHelpCenter("s")).toEqual([]);
    expect(searchHelpCenter("bottom bar")[0]?.slug).toBe("bottom-island");
    expect(searchHelpCenter("offline scouting")[0]?.slug).toBe("scouting-offline");
  });

  it("only known topics are accepted from the address", () => {
    expect(isHelpTopicId("build")).toBe(true);
    expect(isHelpTopicId("billing-plans")).toBe(false);
    expect(isHelpTopicId(null)).toBe(false);
  });
});
