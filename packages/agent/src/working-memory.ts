/**
 * Shared working-memory layer for chat, autonomous, and CAD loops.
 * Pins the goal and open todos so extractive compact cannot drop them.
 * Tool results are excerpted — never invented — using the same 2k/8k caps
 * as autonomous persist (MAX_SUMMARY_CHARS / MAX_EXCERPT_CHARS).
 */

import type { ContextItem } from "./index";
import { MAX_EXCERPT_CHARS, MAX_SUMMARY_CHARS } from "./autonomous-agent-store";
import { compactContextItems, estimateItemTokens } from "./context-compact";

export const PINNED_GOAL_IMPORTANCE = 990;
export const PINNED_TODOS_IMPORTANCE = 980;
export const RECENT_TOOL_EXCERPT_IMPORTANCE = 900;
export const OLDER_TOOL_DUMP_IMPORTANCE = 40;
export const RECENT_TOOL_EXCERPT_COUNT = 3;

export const WORKING_GOAL_ITEM_ID = "working-goal";
export const WORKING_TODOS_ITEM_ID = "working-todos";
export const TOOL_EXCERPT_ID_PREFIX = "tool-excerpt:";

export const WORKING_MEMORY_SUMMARY_CHARS = MAX_SUMMARY_CHARS;
export const WORKING_MEMORY_EXCERPT_CHARS = MAX_EXCERPT_CHARS;

export type WorkingTodo = {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  sortKey?: number;
};

export type ExcerptToolResultOptions = {
  toolName?: string;
  status?: string;
  index?: number;
  maxExcerptChars?: number;
  maxSummaryChars?: number;
};

export type AssembleStepContextInput = {
  goal: string | ContextItem;
  todos?: readonly WorkingTodo[] | ContextItem | null;
  /** Other context (org rules, session, memories). Excerpt-prefixed ids are re-ranked. */
  items?: readonly ContextItem[];
  /** Chronological excerpts from excerptToolResult (oldest first). Last 3 stay high-importance. */
  toolExcerpts?: readonly ContextItem[];
  tokenBudget: number;
  recentExcerptCount?: number;
};

export type AssembledStepContext = {
  items: ContextItem[];
  estimatedTokens: number;
  compacted: boolean;
};

export function isPinnedWorkingTodo(todo: Pick<WorkingTodo, "status">): boolean {
  switch (todo.status) {
    case "pending":
    case "in_progress":
    case "blocked":
      return true;
    case "done":
      return false;
    default: {
      const _never: never = todo.status;
      return _never;
    }
  }
}

export function isToolExcerptItem(item: Pick<ContextItem, "id">): boolean {
  return item.id.startsWith(TOOL_EXCERPT_ID_PREFIX);
}

export function pinGoal(goal: string): ContextItem {
  return {
    type: "task",
    id: WORKING_GOAL_ITEM_ID,
    importance: PINNED_GOAL_IMPORTANCE,
    content: `Goal: ${goal.trim()}`,
  };
}

export function todosToContextItem(todos: readonly WorkingTodo[]): ContextItem | null {
  const open = [...todos].filter(isPinnedWorkingTodo).sort((a, b) => {
    const aKey = a.sortKey ?? 0;
    const bKey = b.sortKey ?? 0;
    return aKey - bKey;
  });
  if (!open.length) return null;
  return {
    type: "task",
    id: WORKING_TODOS_ITEM_ID,
    importance: PINNED_TODOS_IMPORTANCE,
    content: ["Open todos:", ...open.map((todo) => `- [${formatTodoStatus(todo.status)}] ${todo.label}`)].join(
      "\n",
    ),
  };
}

export function excerptToolResult(result: unknown, options?: ExcerptToolResultOptions): ContextItem {
  const maxExcerpt = options?.maxExcerptChars ?? WORKING_MEMORY_EXCERPT_CHARS;
  const maxSummary = options?.maxSummaryChars ?? WORKING_MEMORY_SUMMARY_CHARS;
  const index = options?.index ?? 0;
  const toolName = options?.toolName?.trim() || pickStringField(result, ["tool", "toolName", "name"]);
  const status = options?.status?.trim() || pickStringField(result, ["status"]);
  const body = extractiveExcerptBody(result, maxExcerpt, maxSummary);
  const lines: string[] = [];
  if (toolName) lines.push(`tool: ${toolName}`);
  if (status) lines.push(`status: ${status}`);
  if (body) lines.push(body);
  const idName = sanitizeExcerptId(toolName ?? "tool");
  return {
    type: "module_fact",
    id: `${TOOL_EXCERPT_ID_PREFIX}${idName}:${index}`,
    importance: RECENT_TOOL_EXCERPT_IMPORTANCE,
    content: lines.join("\n"),
  };
}

/**
 * Goal, then open/in-progress todos, then compactContextItems on everything else.
 * Pinned items are never passed to compact, so they cannot be folded away.
 */
export function assembleStepContext(input: AssembleStepContextInput): AssembledStepContext {
  const goalItem = resolveGoalItem(input.goal);
  const todosItem = resolveTodosItem(input.todos);
  const pinned: ContextItem[] = todosItem ? [goalItem, todosItem] : [goalItem];
  const pinnedIds = new Set(pinned.map((item) => item.id));
  const pinnedTokens = pinned.reduce((sum, item) => sum + estimateItemTokens(item), 0);

  const incoming = [...(input.items ?? []), ...(input.toolExcerpts ?? [])];
  const excerpts: ContextItem[] = [];
  const other: ContextItem[] = [];
  for (const item of incoming) {
    if (pinnedIds.has(item.id)) continue;
    if (isToolExcerptItem(item)) excerpts.push(item);
    else other.push(item);
  }

  const recentCount = input.recentExcerptCount ?? RECENT_TOOL_EXCERPT_COUNT;
  const rankedExcerpts = rankToolExcerpts(excerpts, recentCount);
  const rest = [...other, ...rankedExcerpts];
  const restBudget = Math.max(0, input.tokenBudget - pinnedTokens);
  const compacted = compactContextItems(rest, restBudget);

  return {
    items: [...pinned, ...compacted.items],
    estimatedTokens: pinnedTokens + compacted.estimatedTokens,
    compacted: compacted.compacted,
  };
}

function formatTodoStatus(status: WorkingTodo["status"]): string {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "in_progress";
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

function resolveGoalItem(goal: string | ContextItem): ContextItem {
  if (typeof goal === "string") return pinGoal(goal);
  return {
    ...goal,
    id: goal.id || WORKING_GOAL_ITEM_ID,
    importance: PINNED_GOAL_IMPORTANCE,
  };
}

function isTodoList(value: readonly WorkingTodo[] | ContextItem): value is readonly WorkingTodo[] {
  return Array.isArray(value);
}

function resolveTodosItem(todos: AssembleStepContextInput["todos"]): ContextItem | null {
  if (todos == null) return null;
  if (isTodoList(todos)) return todosToContextItem(todos);
  return {
    ...todos,
    id: todos.id || WORKING_TODOS_ITEM_ID,
    importance: PINNED_TODOS_IMPORTANCE,
  };
}

function rankToolExcerpts(excerpts: ContextItem[], recentCount: number): ContextItem[] {
  const keep = Math.max(0, recentCount);
  return excerpts.map((item, index) => ({
    ...item,
    importance:
      index >= excerpts.length - keep ? RECENT_TOOL_EXCERPT_IMPORTANCE : OLDER_TOOL_DUMP_IMPORTANCE,
  }));
}

function pickStringField(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return undefined;
}

function extractiveExcerptBody(value: unknown, maxExcerpt: number, maxSummary: number): string {
  if (value == null) return "";
  if (typeof value === "string") return capExtractive(value, maxExcerpt);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  const excerpt = pickStringField(value, ["excerpt", "resultExcerpt", "text", "content"]);
  const summary = pickStringField(value, ["summary", "resultSummary"]);
  const parts: string[] = [];
  if (summary) parts.push(`summary: ${capExtractive(summary, maxSummary)}`);
  if (excerpt) {
    parts.push(capExtractive(excerpt, maxExcerpt));
    return parts.join("\n");
  }
  if (parts.length) return parts.join("\n");
  return capExtractive(safeStringify(value), maxExcerpt);
}

function capExtractive(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function sanitizeExcerptId(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "tool";
}
