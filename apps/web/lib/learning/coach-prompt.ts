// Optional AI coach paragraph for a revealed call.
//
// The deterministic explanation from predictions.ts is the answer and always
// renders first; this only adds nuance. The prompt therefore hands the model the
// numbers AND the sentence the maths already produced, and forbids it from
// restating, contradicting, or inventing beyond them. When no adapter resolves,
// the surface simply shows the deterministic text — never a fabricated coach.
//
// Pure module: no DB, no React, no I/O.

import { learningSurfaceLabel, type LearningSurface } from "./learning-mode";

export type CoachPromptInput = {
  surface: LearningSurface;
  fieldLabel: string;
  unit: string;
  predicted: number;
  actual: number;
  closeness: string;
  /** The deterministic sentence the maths already produced. */
  deterministic: string;
  /** Optional named misconception the maths already matched. */
  misconception?: string | null;
  /** The student's own inputs for this calculation, already redacted to numbers. */
  inputSummary: string;
};

export const LEARNING_COACH_FEATURE = "learning_coach";

export function buildCoachPrompt(input: CoachPromptInput): string {
  const lines = [
    "You are a veteran FRC build mentor coaching one student on a prediction they just committed.",
    `Surface: ${learningSurfaceLabel(input.surface)}.`,
    `Field: ${input.fieldLabel}${input.unit ? ` (${input.unit.trim()})` : ""}.`,
    `Their inputs: ${input.inputSummary || "not provided"}.`,
    `They called ${input.predicted}${input.unit}; the calculator computed ${input.actual}${input.unit} (${input.closeness}).`,
    `The maths already told them: "${input.deterministic}"`,
  ];
  if (input.misconception) lines.push(`The maths also matched this specific method: "${input.misconception}"`);
  lines.push(
    "",
    "Write ONE short paragraph (max 60 words) that adds something the sentences above do not already say:",
    "why this matters on a real robot, or what to check on the actual machine next.",
    "Rules: do not restate the numbers, do not contradict the computed result, do not invent any",
    "figure that is not above, do not praise, no lists, no headings, no sign-off. Plain prose only.",
  );
  return lines.join("\n");
}

/**
 * Trim a model reply down to the one paragraph we asked for. Returns null when
 * the model produced nothing usable, so the caller can fall back to the
 * deterministic text instead of rendering an empty coach box.
 */
export function cleanCoachParagraph(text: string | null | undefined, maxWords = 90): string | null {
  if (typeof text !== "string") return null;
  const firstParagraph = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!firstParagraph) return null;
  const collapsed = firstParagraph.replace(/^[-*•]\s*/, "").replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const words = collapsed.split(" ");
  return words.length <= maxWords ? collapsed : `${words.slice(0, maxWords).join(" ")}…`;
}
