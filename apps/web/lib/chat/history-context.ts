import { digestThreadTurns } from "@vantage/agent";

/**
 * Shape stored chat turns for the model.
 *
 * The adapter always appends the new user message itself. This helper only
 * returns *prior* user/assistant turns. An empty thread yields `history: []`
 * so the model sees just the new message.
 *
 * Never invents DEMO replies or assistant content — every history row comes
 * from a stored turn.
 */

export const CHAT_HISTORY_TOKEN_BUDGET = 1_800;
export const CHAT_HISTORY_MAX_TURNS = 20;

export type ChatHistoryTurn = {
  id?: string | null;
  role?: string | null;
  content?: string | null;
};

export type ChatModelMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type ChatHistoryContext = {
  /** Prior turns for `adapter.complete({ history })`. Empty on the first message. */
  history: ChatModelMessage[];
  /** The new user message only — never duplicated into `history`. */
  message: string;
  estimatedTokens: number;
  /**
   * Extractive digest of turns that did not fit the token/count budget.
   * Caller's own words only — never an invented recap. Empty when nothing was dropped.
   */
  droppedDigest: string;
};

function trimContent(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRole(role: string | null | undefined): "user" | "assistant" | null {
  return role === "user" || role === "assistant" ? role : null;
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4) + 4;
}

/**
 * Convert stored thread rows + the new user message into the model payload.
 *
 * `turns` must be chronological (oldest first), matching `getMessages`.
 */
export function buildHistoryContext(input: {
  turns?: ChatHistoryTurn[] | null;
  message: string;
  tokenBudget?: number;
  maxTurns?: number;
}): ChatHistoryContext {
  const message = trimContent(input.message);
  const tokenBudget = input.tokenBudget ?? CHAT_HISTORY_TOKEN_BUDGET;
  const maxTurns = input.maxTurns ?? CHAT_HISTORY_MAX_TURNS;

  const usable: ChatModelMessage[] = [];
  for (const [index, turn] of (input.turns ?? []).entries()) {
    const role = asRole(turn.role);
    const content = trimContent(turn.content);
    if (!role || !content) continue;
    const id = typeof turn.id === "string" && turn.id.trim() ? turn.id.trim() : `turn-${index}`;
    usable.push({ id, role, content });
  }

  // The adapter appends `message` as the current user turn. Drop a trailing
  // stored copy so a retry cannot prompt the same text twice.
  const last = usable.at(-1);
  if (last?.role === "user" && last.content === message) {
    usable.pop();
  }

  const selected: ChatModelMessage[] = [];
  const dropped: ChatModelMessage[] = [];
  let estimatedTokens = 0;
  const budget = Math.max(0, tokenBudget);
  const cap = Math.max(0, maxTurns);
  for (const turn of usable.slice().reverse()) {
    const tokens = estimateTokens(turn.content);
    if (selected.length >= cap || estimatedTokens + tokens > budget) {
      dropped.push(turn);
      continue;
    }
    selected.push(turn);
    estimatedTokens += tokens;
  }

  return {
    history: selected.reverse(),
    message,
    estimatedTokens,
    droppedDigest: digestThreadTurns(
      dropped.reverse().map((turn) => ({ role: turn.role, content: turn.content })),
    ),
  };
}
