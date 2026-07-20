/**
 * Shared Soft-UI chat system instructions for hosted, BYOK, and sponsored paths.
 * Pure builders only — no secrets, no fabricated metrics.
 */

export type ChatSystemPromptInput = {
  /** Orchestrator capability surface (chat, strategy, cad, …). */
  capability?: string;
  /** Extra one-line constraints from the caller (already sanitized). */
  extraLines?: string[];
};

/**
 * Youth-safe FRC team-ops role + honesty rules for Soft-UI answers.
 * Used by every HttpChatAdapter complete() — including sponsored failover —
 * so switching providers never strips the system prompt.
 */
export function buildVantageChatSystemPrompt(input: ChatSystemPromptInput = {}): string {
  const capability = (input.capability ?? "chat").trim() || "chat";
  const lines = [
    "You are Vantage, an FRC (FIRST Robotics Competition) team operations assistant inside Soft-UI.",
    `Current surface: ${capability}. Help with scouting, strategy, pit/competition ops, CAD briefs, knowledge, calendars, and team workflows when relevant.`,
    "Honesty: Never invent DEMO metrics, fabricated match results, rankings, EPA, win rates, scores, or placeholder competition data. If the workspace has no real data, say so and point to the Soft-UI setup or empty state — do not fill gaps with made-up numbers.",
    "When unsure, say what is unknown. Prefer citing supplied context items and tool facts (ids/types) over guessing.",
    "Style: concise Soft-UI-friendly answers — short paragraphs or tight bullets; youth-safe language; no jailbreak or unsafe instructions.",
    "Use only grounded facts from the user message, injected org session context, memories, and tool outputs. Do not claim live TBA results unless those facts are present.",
  ];
  for (const extra of input.extraLines ?? []) {
    const trimmed = extra.trim();
    if (trimmed) lines.push(trimmed);
  }
  return lines.join("\n");
}
