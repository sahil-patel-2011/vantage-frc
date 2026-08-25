import { HELP_ARTICLES, helpArticleHref, helpCategoryLabel, type HelpArticle } from "./articles";

export type HelpSearchHit = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
};

function haystack(article: HelpArticle): string {
  return [
    article.title,
    article.summary,
    article.category,
    helpCategoryLabel(article.category),
    ...article.keywords,
    ...article.sections.flatMap((section) => [section.heading, ...section.body]),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Score a static help article against a normalized query term.
 * Higher is better; 0 means no match.
 */
export function scoreHelpArticle(article: HelpArticle, term: string): number {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return 0;

  const title = article.title.toLowerCase();
  const summary = article.summary.toLowerCase();
  const keywords = article.keywords.map((k) => k.toLowerCase());
  const full = haystack(article);
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);

  // Multi-word: every token must appear somewhere.
  if (tokens.length > 1 && !tokens.every((t) => full.includes(t))) return 0;

  let score = 0;
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 80;
  else if (title.includes(q)) score += 50;

  if (article.slug === q || article.slug.includes(q.replace(/\s+/g, "-"))) score += 40;

  // Title / keyword token hits beat a lone body phrase (e.g. "offline scouting" in Credits copy).
  if (tokens.length >= 1 && tokens.every((t) => title.includes(t))) score += 55;
  for (const t of tokens) {
    if (keywords.some((k) => k === t || k.includes(t) || t.includes(k))) score += 18;
  }

  if (keywords.some((k) => k === q || k.includes(q))) score += 25;
  if (summary.includes(q)) score += 20;
  // Body-only mentions are weak — avoid flooding Cmd+K for terms like "sponsor".
  if (full.includes(q)) {
    const strong =
      tokens.length > 1 ||
      title.includes(q) ||
      keywords.some((k) => k === q || k.includes(q) || q.includes(k));
    score += strong ? 8 : 2;
  }

  return score;
}

/** Search the in-repo help index (no DB / CMS). */
export function searchHelpArticles(term: string, limit = 8): HelpSearchHit[] {
  const q = term.trim();
  if (q.length < 2) return [];

  return HELP_ARTICLES.map((article) => {
    const score = scoreHelpArticle(article, q);
    return {
      id: article.id,
      slug: article.slug,
      title: article.title,
      subtitle: article.summary,
      href: helpArticleHref(article.slug),
      score,
    };
  })
    .filter((hit) => hit.score >= 20)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Filter the hub list as the user types (same scoring, keep zeros out). */
export function filterHelpArticles(term: string): HelpArticle[] {
  const q = term.trim();
  if (q.length < 2) return [...HELP_ARTICLES];
  return HELP_ARTICLES.map((article) => ({ article, score: scoreHelpArticle(article, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title))
    .map((row) => row.article);
}
