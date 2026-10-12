/**
 * Auto-compact long agent context so local Ollama / LM Studio windows
 * (and hosted Claude/OpenAI) stay inside a usable token budget.
 * Extractive — never invents facts, never drops the latest tool results first.
 */

import type { ChatAdapter, ContextItem } from "./index";

export const LOCAL_CONTEXT_TOKEN_BUDGET = 2_800;
/**
 * Hosted Claude and OpenAI models get room for the whole picture: scouting, files and tool
 * results arrive intact rather than folded into excerpts. Kept, with the history below, under
 * 100K tokens a call, where Claude's long-context pricing starts. Prompt caching makes the
 * repeated part cheap.
 */
export const CLOUD_CONTEXT_TOKEN_BUDGET = 48_000;
/** Gemini over its free tier: one turn has to fit GOOGLE_TURN_INPUT_RESERVE (resolve-chat-adapter). */
export const GEMINI_CONTEXT_TOKEN_BUDGET = 8_000;

export function estimateItemTokens(item: Pick<ContextItem, "content">): number {
  return Math.max(1, Math.ceil(item.content.length / 4));
}

export function contextTokenBudgetForAdapter(adapter: Pick<ChatAdapter, "provider" | "model">): number {
  const provider = adapter.provider.toLowerCase();
  const model = adapter.model.toLowerCase();
  // Gemini is reached over the OpenAI-compatible protocol but is not a small local model.
  if (model.startsWith("gemini")) return GEMINI_CONTEXT_TOKEN_BUDGET;
  if (
    provider === "openai-compatible" ||
    provider === "local" ||
    provider === "ollama" ||
    /ollama|lm.?studio|localhost|127\.0\.0\.1/.test(model)
  ) {
    return LOCAL_CONTEXT_TOKEN_BUDGET;
  }
  return CLOUD_CONTEXT_TOKEN_BUDGET;
}

export type ChatHistoryBudget = { maxTurns: number; maxChars: number };

/** Small local models and Gemini's free tier keep the short window. */
export const SHORT_CHAT_HISTORY: ChatHistoryBudget = { maxTurns: 16, maxChars: 12_000 };
/** Hosted Claude and OpenAI keep the conversation verbatim (about 40K tokens). */
export const CLOUD_CHAT_HISTORY: ChatHistoryBudget = { maxTurns: 200, maxChars: 160_000 };

export function chatHistoryBudgetForAdapter(
  adapter: Pick<ChatAdapter, "provider" | "model">,
): ChatHistoryBudget {
  return contextTokenBudgetForAdapter(adapter) === CLOUD_CONTEXT_TOKEN_BUDGET
    ? CLOUD_CHAT_HISTORY
    : SHORT_CHAT_HISTORY;
}

function excerpt(text: string, max = 280): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Keep newest / highest-importance items intact. Older overflow is folded into
 * one compact note so the model still sees what happened without a 32k dump.
 */
export function compactContextItems(
  items: ContextItem[],
  tokenBudget: number,
): { items: ContextItem[]; estimatedTokens: number; compacted: boolean } {
  const budget = Math.max(400, tokenBudget);
  const sorted = [...items].sort((a, b) => b.importance - a.importance);
  const kept: ContextItem[] = [];
  const overflow: ContextItem[] = [];
  let used = 0;
  for (const item of sorted) {
    const cost = estimateItemTokens(item);
    if (used + cost <= budget) {
      kept.push(item);
      used += cost;
    } else {
      overflow.push(item);
    }
  }
  if (!overflow.length) {
    return { items: kept, estimatedTokens: used, compacted: false };
  }
  let compact: ContextItem = {
    type: "module_fact",
    id: "auto-compact",
    importance: 50,
    content: [
      "Compacted earlier context (extractive; not new facts):",
      ...overflow.slice(0, 24).map((item) => `- [${item.type}:${item.id}] ${excerpt(item.content)}`),
    ].join("\n"),
  };
  const minCompact = 80;
  while (kept.length && used + minCompact > budget) {
    const dropped = kept.pop();
    if (dropped) used -= estimateItemTokens(dropped);
  }
  const room = Math.max(minCompact, budget - used);
  while (estimateItemTokens(compact) > room && compact.content.length > 180) {
    compact = { ...compact, content: `${compact.content.slice(0, Math.max(160, Math.floor(compact.content.length * 0.65)))}…` };
  }
  const compactCost = estimateItemTokens(compact);
  kept.push(compact);
  used += compactCost;
  return { items: kept, estimatedTokens: used, compacted: true };
}

export type CompactableTurn = { role: string; content: string };

/**
 * Fold older chat turns into one "Earlier in this conversation…" note so the
 * model's window stays inside budget. The latest turns stay verbatim.
 */
export function compactChatTurns(
  history: CompactableTurn[],
  options?: { maxTurns?: number; maxChars?: number },
): { history: CompactableTurn[]; summary: string | null } {
  const maxTurns = options?.maxTurns ?? SHORT_CHAT_HISTORY.maxTurns;
  const maxChars = options?.maxChars ?? SHORT_CHAT_HISTORY.maxChars;
  const chars = history.reduce((sum, turn) => sum + turn.content.length, 0);
  if (history.length <= maxTurns && chars <= maxChars) {
    return { history, summary: null };
  }
  const keepCount = Math.min(history.length, Math.max(4, maxTurns));
  const keep = history.slice(-keepCount);
  const older = history.slice(0, Math.max(0, history.length - keepCount));
  if (!older.length) {
    return { history: keep, summary: null };
  }
  const summary = older
    .map((turn) => {
      const text = turn.content.replace(/\s+/g, " ").trim().slice(0, 180);
      return `- ${turn.role}: ${text}`;
    })
    .join("\n");
  return { history: keep, summary };
}
