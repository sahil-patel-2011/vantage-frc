/**
 * Quick scout: one match, one robot, the form split into the stages a scout lives through.
 *
 * The full Scout form is a long page with every question on it. At the field a scout
 * watches a robot, not a phone, so Quick scout shows only what can happen right now:
 * the start position before the match, the auto counters during auto, teleop during
 * teleop, the climb in the last 30 seconds, and the "how did it go" questions after
 * the buzzer. The stage follows the match clock the scout starts with the field.
 *
 * Every answer still lands in the team's own published form, through the same save,
 * offline outbox and server checks as the full form, so nothing downstream changes.
 * Pure, so it is tested.
 */

import type { CaptureKind, FieldDefinition } from "@vantage/scouting";
import {
  REBUILT_MATCH_MS,
  activeCaptureBout,
  applyCounterStep,
  correctCaptureBout,
  counterConfig,
  finishCaptureBout,
  isLayoutOnlyField,
  matchCapture,
  startCaptureBout,
} from "@vantage/scouting";
import { isTapCounterField } from "./count-field";
import { phaseAt, type MatchTiming } from "./match-clock";
import { matchFieldStages } from "./match-form-flow";
import type { RobotStation } from "./scout-context";

export type QuickStage = "pre" | "auto" | "teleop" | "endgame" | "review";

export const QUICK_STAGES: readonly QuickStage[] = ["pre", "auto", "teleop", "endgame", "review"];

export const QUICK_STAGE_LABELS: Record<QuickStage, string> = {
  pre: "Before",
  auto: "Auto",
  teleop: "Teleop",
  endgame: "Endgame",
  review: "After",
};

/** How a question is answered on the live screen. */
export type QuickTileKind = "counter" | "toggle" | "choice" | "detail";

/** Few enough options to show every one as a big button. */
const MAX_CHOICE_BUTTONS = 6;

/** The seat a scout is in is read from the schedule, never asked twice. */
export const STATION_FIELD_KEY = "alliance_station";

const SINGLE_CHOICE_TYPES = new Set(["select", "dropdown", "drivetrain_type"]);

export function quickTileKind(field: FieldDefinition): QuickTileKind {
  if (field.type === "counter" || isTapCounterField(field)) return "counter";
  if (field.type === "boolean") return "toggle";
  const options = field.options ?? [];
  const singleChoice =
    SINGLE_CHOICE_TYPES.has(field.type) || (field.type === "multiple_choice" && field.config?.allowMultiple !== true);
  if (singleChoice && options.length > 0 && options.length <= MAX_CHOICE_BUTTONS) return "choice";
  return "detail";
}

/**
 * Which stage each question belongs to. A question the form places (by its phase, its
 * name, or the section it sits in) keeps that stage. One it does not place goes where it
 * can be answered: a count or a yes/no is something you tap while the robot plays, so it
 * goes to teleop; anything you have to think about waits for the post-match questions.
 */
export function quickFieldStages(fields: readonly FieldDefinition[]): Map<string, QuickStage> {
  const named = matchFieldStages(fields);
  const result = new Map<string, QuickStage>();
  for (const field of fields) {
    if (isLayoutOnlyField(field)) continue;
    if (field.key === STATION_FIELD_KEY) {
      result.set(field.key, "pre");
      continue;
    }
    const stage = named.get(field.key);
    if (stage) {
      result.set(field.key, stage);
      continue;
    }
    const kind = quickTileKind(field);
    result.set(field.key, kind === "counter" || kind === "toggle" ? "teleop" : "review");
  }
  return result;
}

/**
 * The questions on screen for a stage. Robots still score during the endgame, so the
 * endgame screen keeps the teleop counters under the climb question.
 */
export function fieldsForQuickStage(fields: readonly FieldDefinition[], stage: QuickStage): FieldDefinition[] {
  const stages = quickFieldStages(fields);
  const own = fields.filter((field) => stages.get(field.key) === stage);
  if (stage !== "endgame") return own;
  const teleop = fields.filter((field) => stages.get(field.key) === "teleop" && quickTileKind(field) !== "detail");
  return [...own, ...teleop];
}

/** Stages that have something to show. Before and After always exist: start and save live there. */
export function stagesWithFields(fields: readonly FieldDefinition[]): QuickStage[] {
  const stages = new Set(quickFieldStages(fields).values());
  return QUICK_STAGES.filter((stage) => stage === "pre" || stage === "review" || stages.has(stage));
}

/** The stage the match clock says the robot is in. The 2026 scoring pause still counts auto fuel. */
export function stageForClock(elapsedMs: number | null, timing: MatchTiming): QuickStage {
  const phase = phaseAt(elapsedMs, timing);
  if (phase === "auto" || phase === "transition") return "auto";
  if (phase === "done") return "review";
  return phase;
}

/** The match's length on this season's clock. */
export function matchLengthMs(timing: MatchTiming): number {
  return timing.autoMs + (timing.transitionMs ?? 0) + timing.teleopMs;
}

/** "Red 2" from the schedule becomes the form's own option ("red2"), when the form has one. */
export function stationAnswer(field: FieldDefinition, station: RobotStation | null): string | null {
  if (!station || field.key !== STATION_FIELD_KEY) return null;
  const wanted = `${station.alliance}${station.station}`;
  const options = field.options ?? [];
  return options.find((option) => option.replace(/[\s_-]+/g, "").toLowerCase() === wanted) ?? null;
}

/** Answers the schedule already knows. Only fills blanks: a scout's own answer always wins. */
export function scheduleAnswers(
  fields: readonly FieldDefinition[],
  payload: Record<string, unknown>,
  station: RobotStation | null,
): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const field of fields) {
    if (payload[field.key] !== undefined && payload[field.key] !== null && payload[field.key] !== "") continue;
    const answer = stationAnswer(field, station);
    if (answer) filled[field.key] = answer;
  }
  return filled;
}

/** The limits of a counted question, from either a counter or a plain number field. */
function counterBounds(field: FieldDefinition): { min: number; max: number | null } {
  if (field.type === "counter") {
    const config = counterConfig(field);
    return { min: Number.isFinite(config.min) ? config.min : 0, max: config.max };
  }
  const config = (field.config ?? {}) as Record<string, unknown>;
  const min = typeof config.min === "number" && Number.isFinite(config.min) ? config.min : 0;
  const max = typeof config.max === "number" && Number.isFinite(config.max) ? config.max : null;
  return { min, max };
}

/**
 * One tap on a counter. A blank count means "not counted"; the first tap makes it 1,
 * and taking it back below the floor clears it to blank again, so an accidental tap
 * never turns into an observed zero.
 */
export function stepCounter(field: FieldDefinition, current: unknown, delta: number): number | undefined {
  const { min, max } = counterBounds(field);
  const blank = typeof current !== "number" || !Number.isFinite(current);
  if (blank && delta < 0) return undefined;
  const base = blank ? min : (current as number);
  // Below the floor is "not counted" again: 1 → 0 is an observed zero, 0 → blank is not.
  if (!blank && delta < 0 && Math.round(base + delta) < min) return undefined;
  if (field.type === "counter") return applyCounterStep(base, delta, counterConfig(field));
  return Math.min(Math.max(Math.round(base + delta), min), max ?? Number.POSITIVE_INFINITY);
}

/** Counts the form asks to be watched (requireObservation) that were left blank. */
export function uncountedFields(fields: readonly FieldDefinition[], payload: Record<string, unknown>): FieldDefinition[] {
  return fields.filter(
    (field) =>
      quickTileKind(field) === "counter" &&
      field.config?.requireObservation === true &&
      (payload[field.key] === undefined || payload[field.key] === null),
  );
}

/** "mostly_hit" reads "Mostly hit" on a button. */
export function optionLabel(option: string): string {
  const words = option.replace(/[_-]+/g, " ").trim();
  if (/^l\d$/i.test(words)) return words.toUpperCase();
  if (/^(red|blue)\s?\d$/i.test(words)) return words.replace(/^(\w)(\w*)\s?(\d)$/i, (_, first: string, rest: string, digit: string) => `${first.toUpperCase()}${rest.toLowerCase()} ${digit}`);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A tile's value in words for the summary: blank stays a dash, never a zero. */
export function answerText(field: FieldDefinition, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return SINGLE_CHOICE_TYPES.has(field.type) || field.type === "multiple_choice" ? optionLabel(value) : value;
  if (Array.isArray(value)) return value.length ? value.map((item) => (typeof item === "string" ? optionLabel(item) : String(item))).join(", ") : "—";
  return "Answered";
}

/**
 * Start or stop a timed action (2026: shooting, feeding, defending, disabled). Only one
 * runs at a time, so starting another stops the one running; one stopped in the same
 * instant it started never ran and is voided instead of failing the save.
 */
export function toggleCaptureAction(
  payload: Record<string, unknown>,
  input: { kind: CaptureKind; id: string; elapsedMs: number; clockStartedAt: number },
): { payload: Record<string, unknown>; started: string | null } {
  const elapsed = Math.floor(input.elapsedMs);
  const running = activeCaptureBout(matchCapture(payload));
  let next = payload;
  if (running) {
    next = elapsed > running.startMs
      ? finishCaptureBout(next, running.id, elapsed)
      : correctCaptureBout(next, running.id, { voided: true });
    if (running.kind === input.kind) return { payload: next, started: null };
  }
  if (elapsed >= REBUILT_MATCH_MS) return { payload: next, started: null };
  return {
    payload: startCaptureBout(next, { id: input.id, kind: input.kind, elapsedMs: elapsed, clockStartedAt: input.clockStartedAt }),
    started: input.id,
  };
}

/** Stops whatever is running, e.g. at the buzzer or when the scout moves on to save. */
export function stopCaptureAction(payload: Record<string, unknown>, elapsedMs: number): Record<string, unknown> {
  const running = activeCaptureBout(matchCapture(payload));
  if (!running) return payload;
  const elapsed = Math.min(REBUILT_MATCH_MS, Math.floor(elapsedMs));
  return elapsed > running.startMs
    ? finishCaptureBout(payload, running.id, elapsed)
    : correctCaptureBout(payload, running.id, { voided: true });
}

/** Undoing a timed action voids it; the interval stays in the record, marked as not counted. */
export function voidCaptureAction(payload: Record<string, unknown>, id: string): Record<string, unknown> {
  const bout = matchCapture(payload)?.bouts.find((candidate) => candidate.id === id);
  if (!bout || bout.voided) return payload;
  return correctCaptureBout(payload, id, { voided: true });
}

/** The undo stack of the live screen: a tapped answer, or a timed action that was started. */
export type QuickUndo = { kind: "answer" } | { kind: "action"; id: string };

export function pushUndo(stack: readonly QuickUndo[], entry: QuickUndo, limit = 200): QuickUndo[] {
  const next = [...stack, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
