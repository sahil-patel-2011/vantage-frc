/**
 * The practice form's state, as a reducer so the rules are testable without a browser:
 * answers are editable only while answering; one check at a time; "Try again" clears the
 * result and hands the answers back, editable, so the ones marked "Not yet" can be fixed.
 *
 * Client-safe and pure.
 */

import type { PracticeSubmission } from "./types";

export type PracticePhase = "answering" | "checking" | "graded";

export type PracticeState = {
  phase: PracticePhase;
  /** Question id → what is typed (a choice is its option index as text). */
  answers: Record<string, string>;
  submitted: PracticeSubmission | null;
  error: string | null;
};

export type PracticeAction =
  | { type: "answer"; id: string; value: string }
  | { type: "check" }
  | { type: "checked"; submitted: PracticeSubmission }
  | { type: "failed"; error: string }
  | { type: "retry" };

export const INITIAL_PRACTICE: PracticeState = { phase: "answering", answers: {}, submitted: null, error: null };

export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  switch (action.type) {
    case "answer":
      if (state.phase !== "answering") return state;
      return { ...state, answers: { ...state.answers, [action.id]: action.value } };
    case "check":
      // A second submit (Enter twice, or a stray submit after Try again) must not grade twice.
      if (state.phase !== "answering") return state;
      return { ...state, phase: "checking", error: null };
    case "checked":
      if (state.phase !== "checking") return state;
      return { ...state, phase: "graded", submitted: action.submitted, error: null };
    case "failed":
      if (state.phase !== "checking") return state;
      // The answers stay, editable, so trying again is one tap.
      return { ...state, phase: "answering", error: action.error };
    case "retry":
      if (state.phase !== "graded") return state;
      return { ...state, phase: "answering", submitted: null, error: null };
    default:
      return state;
  }
}

/** True while the answer fields must not change (checking, or showing a grade). */
export function answersLocked(state: PracticeState): boolean {
  return state.phase !== "answering";
}

/** The first question marked "Not yet", where Try again puts the cursor. Null when all were right. */
export function firstToRevisit(submitted: PracticeSubmission | null, questionIds: readonly string[]): string | null {
  if (!submitted) return null;
  const wrong = new Set(submitted.result.results.filter((result) => !result.correct).map((result) => result.id));
  return questionIds.find((id) => wrong.has(id)) ?? null;
}

/** The submit payload: blanks left out, a choice sent as its option number. */
export function practicePayload(
  questions: readonly { id: string; kind: "choice" | "number" | "text" }[],
  answers: Record<string, string>,
): Record<string, number | string> {
  const payload: Record<string, number | string> = {};
  for (const question of questions) {
    const value = answers[question.id];
    if (value === undefined || value === "") continue;
    payload[question.id] = question.kind === "choice" ? Number(value) : value;
  }
  return payload;
}
