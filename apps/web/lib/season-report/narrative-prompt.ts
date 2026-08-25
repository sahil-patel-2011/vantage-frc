// Season Report — optional AI expansion prompt. Pure, framework-free.
//
// The deterministic snapshot (buildSeasonReportNarrative) is the product; this
// prompt only asks a real model to weave those already-computed facts into a
// cohesive retrospective. It is grounded exclusively in the computed narrative,
// highlights, and watchouts — the model is told to add no numbers or events of
// its own, so a hallucinated stat has nothing to hide behind.

import type { SeasonReportNarrative } from "./types";

export const SEASON_REPORT_AI_FEATURE = "season_report";

export type SeasonNarrativePromptInput = {
  seasonYear: number;
  narrative: SeasonReportNarrative;
  highlights: string[];
  watchouts: string[];
  entryCount: number;
};

const SECTION_LABELS: Array<[keyof SeasonReportNarrative, string]> = [
  ["buildReliability", "Build & reliability"],
  ["results", "Results"],
  ["budget", "Budget"],
  ["outreach", "Outreach"],
  ["lessons", "Lessons"],
];

/**
 * Build the grounded expansion prompt. Returns null when there is nothing real
 * to expand (no logged entries) — the caller must show the honest empty state
 * instead of asking a model to invent a season.
 */
export function buildSeasonNarrativePrompt(input: SeasonNarrativePromptInput): string | null {
  if (input.entryCount <= 0) return null;

  const sections = SECTION_LABELS.map(([key, label]) => `${label}: ${input.narrative[key]}`).join("\n");
  const highlights = input.highlights.length
    ? `Highlights (logged as positive):\n${input.highlights.map((item) => `- ${item}`).join("\n")}`
    : "Highlights: none logged.";
  const watchouts = input.watchouts.length
    ? `Watchouts (logged as needing attention):\n${input.watchouts.map((item) => `- ${item}`).join("\n")}`
    : "Watchouts: none logged.";

  return [
    `You are helping an FRC team turn its ${input.seasonYear} season retrospective into a short narrative for mentors, students, and sponsors.`,
    `The facts below were computed from ${input.entryCount} logged entr${input.entryCount === 1 ? "y" : "ies"}. They are the ONLY source of truth.`,
    "",
    sections,
    "",
    highlights,
    "",
    watchouts,
    "",
    "Write 2-3 cohesive paragraphs that connect these threads: what defined the season, what improved, and what to carry into next season.",
    "Rules: use only the facts above; do not invent numbers, events, awards, or names; if a section says nothing was logged, do not speculate about it; plain prose, no headings or bullet lists.",
  ].join("\n");
}
