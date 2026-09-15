/**
 * Retrieve-before-dump working memory (MemGPT / Claude Code / Cursor pattern).
 * Rank and select existing excerpts — never invent text, metrics, or rows.
 * Types are local so this module cannot cycle through index / working-memory.
 */

type RetrievableExcerpt = {
  id: string;
  content: string;
};

type RetrievableTodoStatus = "pending" | "in_progress" | "done" | "blocked";

type RetrievableTodo = {
  id: string;
  label: string;
  status: RetrievableTodoStatus;
};

export type AlreadyObservedItem = {
  type: "module_fact";
  id: string;
  importance: number;
  content: string;
};

export const DEFAULT_RECENT_EVIDENCE_COUNT = 3;
export const DEFAULT_RELEVANT_EVIDENCE_COUNT = 4;
export const DEFAULT_REFLECTION_EVERY_HOPS = 6;
export const DEFAULT_REFLECTION_EXCERPT_COUNT = 6;
export const ALREADY_OBSERVED_IMPORTANCE = 920;
export const WORKING_ALREADY_OBSERVED_ITEM_ID = "working-already-observed";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "is",
  "it",
  "as",
  "by",
  "be",
  "we",
  "do",
  "if",
  "so",
  "that",
  "this",
  "with",
  "from",
  "into",
  "than",
  "then",
  "but",
  "not",
  "are",
  "was",
  "were",
  "been",
  "being",
  "has",
  "have",
  "had",
  "will",
  "would",
  "can",
  "could",
  "should",
  "may",
  "might",
  "your",
  "you",
  "our",
  "their",
  "its",
  "vs",
]);

export type MemoryHitKind = "excerpt" | "todo";

export type MemoryHit = {
  kind: MemoryHitKind;
  id: string;
  quote: string;
  matchedTokens: string[];
};

export type WorkingEvidenceSelection<T extends RetrievableExcerpt = RetrievableExcerpt> = {
  recent: T[];
  relevant: T[];
  selected: T[];
};

export type SelectWorkingEvidenceInput<T extends RetrievableExcerpt = RetrievableExcerpt> = {
  goal: string;
  todos?: readonly RetrievableTodo[] | null;
  excerpts: readonly T[];
  recentCount?: number;
  relevantCount?: number;
};

export function tokenizeGoal(text: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

export function scoreExcerptAgainstGoal(
  excerpt: Pick<RetrievableExcerpt, "content">,
  goal: string,
  todos?: readonly RetrievableTodo[] | null,
): number {
  const query = queryTokenSet(goal, openTodos(todos));
  if (!query.size) return 0;
  let score = 0;
  for (const token of tokenizeGoal(excerpt.content)) {
    if (query.has(token)) score += 1;
  }
  return score;
}

/**
 * Last-N recency plus top-k older excerpts that overlap the pinned goal / open todos.
 * Returns existing items only — empty excerpts yield an empty selection.
 */
export function selectWorkingEvidence<T extends RetrievableExcerpt>(
  input: SelectWorkingEvidenceInput<T>,
): WorkingEvidenceSelection<T> {
  const excerpts = input.excerpts;
  if (!excerpts.length) {
    return { recent: [], relevant: [], selected: [] };
  }

  const recentCount = Math.max(0, input.recentCount ?? DEFAULT_RECENT_EVIDENCE_COUNT);
  const relevantCount = Math.max(0, input.relevantCount ?? DEFAULT_RELEVANT_EVIDENCE_COUNT);
  const recentStart = Math.max(0, excerpts.length - recentCount);
  const recent = excerpts.slice(recentStart).map((item) => item);
  const older = excerpts.slice(0, recentStart);

  const rankedOlder = older
    .map((excerpt, index) => ({
      excerpt,
      index,
      score: scoreExcerptAgainstGoal(excerpt, input.goal, input.todos),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, relevantCount)
    .sort((a, b) => a.index - b.index);

  const relevant = rankedOlder.map((row) => row.excerpt);
  return { recent, relevant, selected: [...relevant, ...recent] };
}

export function memoryHitsForQuery(
  query: string,
  excerpts: readonly Pick<RetrievableExcerpt, "id" | "content">[],
  todos?: readonly RetrievableTodo[] | null,
): MemoryHit[] {
  const queryTokens = tokenizeGoal(query);
  if (!queryTokens.length) return [];
  const querySet = new Set(queryTokens);
  const hits: MemoryHit[] = [];

  for (const excerpt of excerpts) {
    const matched = tokenizeGoal(excerpt.content).filter((token) => querySet.has(token));
    if (!matched.length) continue;
    const quote = extractiveQuote(excerpt.content, matched);
    if (!quote) continue;
    hits.push({ kind: "excerpt", id: excerpt.id, quote, matchedTokens: matched });
  }

  for (const todo of todos ?? []) {
    const matched = tokenizeGoal(todo.label).filter((token) => querySet.has(token));
    if (!matched.length) continue;
    hits.push({
      kind: "todo",
      id: todo.id,
      quote: extractiveQuote(todo.label, matched) || todo.label,
      matchedTokens: matched,
    });
  }

  return hits;
}

/**
 * Extractive "what's working / still open" note. Quotes existing text only — no new claims.
 */
export function extractiveReflection(
  goal: string,
  todos: readonly RetrievableTodo[] | null | undefined,
  excerpts: readonly Pick<RetrievableExcerpt, "content">[],
  lastN = DEFAULT_REFLECTION_EXCERPT_COUNT,
): string {
  const lines: string[] = ["what's working / still open"];
  const goalQuote = quoteSlice(goal);
  if (goalQuote) lines.push(`Goal: "${goalQuote}"`);

  const open = openTodos(todos);
  if (open.length) {
    lines.push("still open:");
    for (const todo of open) {
      const label = quoteSlice(todo.label);
      if (label) lines.push(`- "${label}"`);
    }
  }

  const source = excerpts.slice(-Math.max(0, lastN));
  if (source.length) {
    lines.push("what's working:");
    for (const excerpt of source) {
      const quote = quoteSlice(excerpt.content);
      if (quote) lines.push(`- "${quote}"`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

export function shouldReflectOnHop(
  hopIndex: number,
  every = DEFAULT_REFLECTION_EVERY_HOPS,
): boolean {
  const cadence = Math.max(1, every);
  return hopIndex > 0 && hopIndex % cadence === 0;
}

export function alreadyObservedContextItem(hits: readonly MemoryHit[]): AlreadyObservedItem | null {
  if (!hits.length) return null;
  return {
    type: "module_fact",
    id: WORKING_ALREADY_OBSERVED_ITEM_ID,
    importance: ALREADY_OBSERVED_IMPORTANCE,
    content: [
      "Already observed in working memory (web.search may still run — web can be fresher):",
      ...hits.map(formatMemoryHit),
    ].join("\n"),
  };
}

function formatMemoryHit(hit: MemoryHit): string {
  switch (hit.kind) {
    case "excerpt":
      return `- excerpt: "${hit.quote}"`;
    case "todo":
      return `- todo: "${hit.quote}"`;
    default: {
      const _never: never = hit.kind;
      return _never;
    }
  }
}

function openTodos(todos?: readonly RetrievableTodo[] | null): RetrievableTodo[] {
  return (todos ?? []).filter((todo) => isOpenTodoStatus(todo.status));
}

function isOpenTodoStatus(status: RetrievableTodoStatus): boolean {
  switch (status) {
    case "pending":
    case "in_progress":
    case "blocked":
      return true;
    case "done":
      return false;
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

function queryTokenSet(goal: string, todos: readonly RetrievableTodo[]): Set<string> {
  const tokens = new Set(tokenizeGoal(goal));
  for (const todo of todos) {
    for (const token of tokenizeGoal(todo.label)) tokens.add(token);
  }
  return tokens;
}

function quoteSlice(text: string, max = 160): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function extractiveQuote(text: string, tokens: readonly string[], max = 180): string {
  const lower = text.toLowerCase();
  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 24);
    const end = Math.min(text.length, idx + token.length + 156);
    const slice = text.slice(start, end).trim();
    if (slice) return slice.length <= max ? slice : slice.slice(0, max);
  }
  return quoteSlice(text, max);
}
