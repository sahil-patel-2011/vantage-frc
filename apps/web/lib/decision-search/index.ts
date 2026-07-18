// Pure, framework-free relevance scoring for Decision Search. Everything here is deterministic
// term-overlap scoring — it never fabricates a match. compute-decision-search.ts wraps this with
// DB I/O; the API route and client render results.

import type { DecisionSearchDocument, DecisionSearchMatch, DecisionSearchSourceKind } from "./types";

export const DECISION_SEARCH_SOURCE_KINDS: DecisionSearchSourceKind[] = [
  "decision",
  "design_review",
  "notebook_entry",
];

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "and", "or", "in", "on", "for", "is", "was", "with",
  "this", "that", "it", "we", "our", "at", "be", "by", "as", "how", "what", "why", "did",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Deterministic relevance score in [0,1]: overlap of query terms against title+body+tags. */
export function scoreDocument(queryTerms: string[], doc: DecisionSearchDocument): DecisionSearchMatch {
  const titleTerms = new Set(tokenize(doc.title));
  const bodyTerms = new Set(tokenize(doc.body));
  const tagTerms = new Set(doc.tags.map((tag) => tag.toLowerCase()));

  const matchedTerms: string[] = [];
  let weight = 0;
  for (const term of queryTerms) {
    let hit = false;
    if (titleTerms.has(term)) {
      weight += 3;
      hit = true;
    }
    if (tagTerms.has(term)) {
      weight += 2;
      hit = true;
    }
    if (bodyTerms.has(term)) {
      weight += 1;
      hit = true;
    }
    if (hit) matchedTerms.push(term);
  }

  const maxWeight = Math.max(1, queryTerms.length * 3);
  const score = round(Math.min(1, weight / maxWeight));
  return { document: doc, score, matchedTerms };
}

/** Ranks documents by relevance to the query text; drops non-matches. Deterministic, no model call. */
export function searchDocuments(query: string, documents: DecisionSearchDocument[]): DecisionSearchMatch[] {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0) return [];
  return documents
    .map((doc) => scoreDocument(queryTerms, doc))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.document.createdAt.localeCompare(a.document.createdAt));
}

/** A short, grounded summary of a search result set — never invents content beyond the matches. */
export function summarizeMatches(query: string, matches: DecisionSearchMatch[]): string {
  if (matches.length === 0) {
    return `No indexed decisions, design reviews, or notebook entries matched "${query}".`;
  }
  const top = matches.slice(0, 3).map((m) => m.document.title);
  return `${matches.length} match(es) for "${query}" — top: ${top.join("; ")}.`;
}

export function decisionSearchSourceLabel(kind: DecisionSearchSourceKind): string {
  switch (kind) {
    case "decision":
      return "Decision";
    case "design_review":
      return "Design review";
    default:
      return "Notebook entry";
  }
}
