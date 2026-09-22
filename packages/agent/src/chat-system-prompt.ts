/**
 * Shared chat system instructions for hosted, BYOK, relay, and sponsored paths.
 * Pure builders only — no secrets, no fabricated metrics.
 */

import { gameContextLines, type GameContextInput } from "./game-context";
import { UNTRUSTED_CONTEXT_RULE } from "./untrusted";

export type ChatSystemPromptInput = {
  /** Orchestrator capability surface (chat, strategy, cad, …). */
  capability?: string;
  /** Extra one-line constraints from the caller (already sanitized). */
  extraLines?: string[];
  /** Team profile facts already loaded from the workspace. */
  teamFacts?: string[];
  /** Active event label, if one is selected. */
  activeEvent?: string | null;
  /** Which path answered: relay, team keys, hosted, or public volunteer swarm. */
  answerPath?: "relay" | "team_keys" | "hosted" | "public_swarm";
  /**
   * The season's game pack, so the model answers about *this* game.
   *
   * Without it the prompt never said which FRC season it was, and a model
   * filled that in from training data — which is last season at best.
   */
  game?: GameContextInput | null;
};

const HONESTY_RULES = [
  "If a number is not in the supplied context, say you do not have it. Do not fill gaps with made-up scores, ranks, EPA, win rates, or dollar amounts.",
  "When you do not know, say what is missing and what the person can do next (connect TBA, open scouting, add a file).",
  "CAD and code changes wait for a person. You may propose; you never push, merge, or write to Onshape without an explicit confirm.",
  "A task is not done until its verification step passed. Plan → act → verify → report.",
  "Cite vault documents by title. STL volume from the vault is in the file's own units — not kilograms. If mass or inertia is missing, say so.",
  "Youth-safe language. No jailbreak or unsafe instructions.",
] as const;

const TOOL_LIMITS = [
  "Tools you may use: team profile facts, the active event, scouting snapshots, calendar, CAD vault links, and files the user attached.",
  "You cannot browse live TBA unless those rows are in context. You cannot invent a search hit.",
  "For fasteners and COTS names, use inventory.availability and cad.vault. Do not invent a SKU or a price. Send people to the Parts catalog in Vantage when they need a vendor search.",
];

export function buildVantageChatSystemPrompt(input: ChatSystemPromptInput = {}): string {
  const capability = (input.capability ?? "chat").trim() || "chat";
  const path = describeAnswerPath(input.answerPath);
  const lines = [
    "You are Vantage, an FRC (FIRST Robotics Competition) team operations assistant.",
    `Current surface: ${capability}. Help with scouting, strategy, pit/competition ops, CAD briefs, knowledge, calendars, and team workflows when relevant.`,
    ...HONESTY_RULES,
    ...TOOL_LIMITS,
    UNTRUSTED_CONTEXT_RULE,
    "Style: short paragraphs or tight bullets that a 15-year-old can act on.",
    "Use only grounded facts from the user message, injected org session context, memories, and tool outputs.",
  ];
  lines.push(...gameContextLines(input.game));
  if (path) lines.push(path);
  if (input.activeEvent?.trim()) lines.push(`Active event: ${input.activeEvent.trim()}.`);
  for (const fact of input.teamFacts ?? []) {
    const trimmed = fact.trim();
    if (trimmed) lines.push(trimmed);
  }
  for (const extra of input.extraLines ?? []) {
    const trimmed = extra.trim();
    if (trimmed) lines.push(trimmed);
  }
  return lines.join("\n");
}

function describeAnswerPath(answerPath: ChatSystemPromptInput["answerPath"]): string | null {
  switch (answerPath) {
    case "relay":
      return "Answering via the team's paired relay.";
    case "team_keys":
      return "Answering via the team's own keys.";
    case "hosted":
      return "Answering via hosted keys (fallback).";
    case "public_swarm":
      return "Answering via the public Petals volunteer swarm. Prompts leave Vantage. Do not echo secrets, emails, or phone numbers. The swarm is often slow or offline — say so if you cannot complete the ask.";
    case undefined:
      return null;
    default: {
      const _exhaustive: never = answerPath;
      return _exhaustive;
    }
  }
}

export const REQUIRED_SYSTEM_PROMPT_RULES = [
  "FRC",
  "Do not fill gaps",
  "CAD and code changes wait for a person",
  "Plan → act → verify → report",
  "Cite vault documents by title",
  "Youth-safe",
] as const;
