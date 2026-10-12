/**
 * The Help center's topics: seven calm cards instead of thirteen chips.
 *
 * The articles keep their own categories (the App manual at /docs still lists them); the Help
 * center groups those categories into topics a person recognises, merging the small ones.
 * "Billing & plans" is not a topic: Vantage is free, and its two articles (what it costs, AI
 * spend limits on your own key) are about AI keys, so they live under Ask AI.
 * Pure data, safe for client bundles.
 */
import type { ProductNavIcon } from "../nav/product-nav";
import { HELP_ARTICLES, type HelpArticle, type HelpCategoryId } from "./articles";
import { filterHelpArticles } from "./search-help";

export type HelpTopicId = "getting-started" | "competition" | "team" | "build" | "business" | "ai" | "accounts";

export type HelpTopic = {
  id: HelpTopicId;
  label: string;
  /** One line under the name on its card. */
  blurb: string;
  icon: ProductNavIcon;
  categories: HelpCategoryId[];
};

export const HELP_TOPICS: readonly HelpTopic[] = [
  { id: "getting-started", label: "Getting started", blurb: "Your first week: the menus, Home and your apps.", icon: "play", categories: ["getting-started"] },
  { id: "competition", label: "Scouting and events", blurb: "Scouting, event day, match plans and picks.", icon: "scout", categories: ["competition"] },
  { id: "team", label: "Your team", blurb: "Calendar, tasks, files and the team library.", icon: "users", categories: ["team"] },
  { id: "build", label: "Build", blurb: "CAD, code reviews and the robot.", icon: "cube", categories: ["build"] },
  { id: "business", label: "Business and outreach", blurb: "Money, sponsors, posts and photos.", icon: "clipboard", categories: ["business", "media"] },
  { id: "ai", label: "Ask AI", blurb: "What it can answer, AI keys and spend limits.", icon: "sparkles", categories: ["ai-models", "billing-plans"] },
  { id: "accounts", label: "Accounts and settings", blurb: "Invites, roles, sign-in and connected tools.", icon: "gear", categories: ["account-access", "admin-owner", "integrations"] },
];

const TOPIC_BY_CATEGORY = new Map<HelpCategoryId, HelpTopic>(
  HELP_TOPICS.flatMap((topic) => topic.categories.map((category) => [category, topic] as const)),
);

export function isHelpTopicId(value: unknown): value is HelpTopicId {
  return typeof value === "string" && HELP_TOPICS.some((topic) => topic.id === value);
}

export function helpTopicFor(article: HelpArticle): HelpTopic {
  return TOPIC_BY_CATEGORY.get(article.category) ?? HELP_TOPICS[0]!;
}

export function helpTopicArticles(id: HelpTopicId): HelpArticle[] {
  return HELP_ARTICLES.filter((article) => helpTopicFor(article).id === id);
}

/**
 * The articles people need most, chosen by hand (Vantage keeps no reading statistics, so the
 * list is not ranked by views): set up, scout, invite, work offline, change your apps, Ask AI.
 */
export const POPULAR_HELP_SLUGS: readonly string[] = [
  "getting-started",
  "saturday-scouting",
  "team-invites",
  "scouting-offline",
  "bottom-island",
  "ask-ai",
];

export function popularHelpArticles(): HelpArticle[] {
  return POPULAR_HELP_SLUGS.flatMap((slug) => HELP_ARTICLES.filter((article) => article.slug === slug));
}

/** Search the manual as you type (two letters or more), best match first. */
export function searchHelpCenter(query: string): HelpArticle[] {
  return query.trim().length >= 2 ? filterHelpArticles(query) : [];
}
