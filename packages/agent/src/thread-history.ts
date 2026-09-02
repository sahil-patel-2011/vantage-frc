/**
 * Chat memory for agent threads. Until now every turn was sent to the model alone —
 * agent_messages were read for display only. This loads the prior turns of a thread
 * as an ordered history the adapters pass to the provider (or prepend to the message
 * when the provider only takes one).
 */

import type { PoolClient } from "@neondatabase/serverless";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const THREAD_HISTORY_MAX_TURNS = 20;
export const THREAD_HISTORY_MAX_CHARS = 24_000;

/**
 * Keep the most recent turns under the char budget (oldest dropped first), merge
 * consecutive same-role turns and make sure the history starts with a user turn —
 * the shape both the Anthropic and OpenAI message APIs accept.
 */
export function trimThreadHistory(
  turns: ChatTurn[],
  options?: { maxTurns?: number; maxChars?: number },
): ChatTurn[] {
  const maxTurns = options?.maxTurns ?? THREAD_HISTORY_MAX_TURNS;
  const maxChars = options?.maxChars ?? THREAD_HISTORY_MAX_CHARS;
  const cleaned = turns
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && turn.content?.trim())
    .map((turn) => ({ role: turn.role, content: turn.content.trim() }));

  const kept: ChatTurn[] = [];
  let chars = 0;
  for (let i = cleaned.length - 1; i >= 0 && kept.length < maxTurns; i -= 1) {
    const turn = cleaned[i]!;
    if (chars + turn.content.length > maxChars) break;
    kept.unshift(turn);
    chars += turn.content.length;
  }

  const merged: ChatTurn[] = [];
  for (const turn of kept) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      last.content = `${last.content}\n\n${turn.content}`;
    } else {
      merged.push({ ...turn });
    }
  }
  while (merged.length && merged[0]!.role !== "user") merged.shift();
  return merged;
}

/**
 * Prior turns of a thread, oldest first, excluding the message being answered.
 * Tolerant of a thread with no history (new thread) — returns [].
 */
export async function loadThreadHistory(
  client: PoolClient,
  input: { threadId: string; excludeMessageId?: string | null; maxTurns?: number; maxChars?: number },
): Promise<ChatTurn[]> {
  const maxTurns = input.maxTurns ?? THREAD_HISTORY_MAX_TURNS;
  const result = await client.query<{ role: string; content: string }>(
    `SELECT role, content
       FROM agent_messages
      WHERE thread_id = $1::uuid
        AND role IN ('user', 'assistant')
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      ORDER BY created_at DESC
      LIMIT $3`,
    [input.threadId, input.excludeMessageId ?? null, maxTurns],
  );
  const turns: ChatTurn[] = result.rows
    .map((row) => ({ role: row.role as ChatTurn["role"], content: row.content }))
    .reverse();
  return trimThreadHistory(turns, { maxTurns, maxChars: input.maxChars });
}

/** Rough token count for the history (≈4 chars/token) for pre-call estimates. */
export function estimateHistoryTokens(history: ChatTurn[] | undefined): number {
  if (!history?.length) return 0;
  return history.reduce((sum, turn) => sum + Math.ceil(turn.content.length / 4), 0);
}

/**
 * Text form for adapters that can only send one message (the subscription bridge's
 * prompt document, single-prompt connectors): prepend the conversation so far.
 */
export function historyToPreamble(history: ChatTurn[] | undefined): string {
  if (!history?.length) return "";
  const lines = history.map(
    (turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`,
  );
  return `=== CONVERSATION SO FAR ===\n${lines.join("\n\n")}\n=== END CONVERSATION ===\n\n`;
}
