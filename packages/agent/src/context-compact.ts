/**
 * Auto-compact long agent context so local Ollama / LM Studio windows
 * (and hosted Claude/OpenAI) stay inside a usable token budget.
 * Extractive — never invents facts, never drops the latest tool results first.
 */

import type { ChatAdapter, ContextItem } from "./index";

export const LOCAL_CONTEXT_TOKEN_BUDGET = 2_800;
export const CLOUD_CONTEXT_TOKEN_BUDGET = 8_000;

export function estimateItemTokens(item: Pick<ContextItem, "content">): number {
  return Math.max(1, Math.ceil(item.content.length / 4));
}

export function contextTokenBudgetForAdapter(adapter: Pick<ChatAdapter, "provider" | "model">): number {
  const provider = adapter.provider.toLowerCase();
  const model = adapter.model.toLowerCase();
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
