import type { PlannedToolCall } from "./auto-tools";

/**
 * Ask AI skills: one assistant, many jobs.
 *
 * A skill is a registry tool named `skill.<id>` whose executor lives with the feature it serves
 * (apps/web/lib/ai-skills) and reads that feature's own records through the request's `withRls`
 * client. The orchestrator treats it like any other read tool; this file only gives the shared
 * shape its output takes, so annotation and the chat can read it without knowing the feature.
 */

export const SKILL_TOOL_PREFIX = "skill.";

export type SkillToolStatus = "ok" | "empty" | "setup_required";

export type SkillToolOutput = {
  kind: "vantage_skill";
  /** Skill id, e.g. "sponsorships". */
  skill: string;
  status: SkillToolStatus;
  classification: "hard_metric" | "scout_observation" | "researched_claim" | "model_inference";
  /** One plain sentence: what the records show, or what is missing. */
  summary: string;
  /**
   * Plain lines computed from the team's records (no model). The chat shows them when AI is off
   * or over its limit, and the model reads them as the grounded part of its answer.
   */
  highlights: string[];
  /** Bounded facts for the model. Never invented: empty arrays and nulls stay empty. */
  data: unknown;
  /** Where the person adds the missing records or finishes the work. */
  next?: { label: string; href: string } | null;
};

export function isSkillToolName(name: string): boolean {
  return name.startsWith(SKILL_TOOL_PREFIX) && name.length > SKILL_TOOL_PREFIX.length;
}

export function skillToolName(skillId: string): string {
  return `${SKILL_TOOL_PREFIX}${skillId}`;
}

export function skillIdFromToolName(name: string): string | null {
  return isSkillToolName(name) ? name.slice(SKILL_TOOL_PREFIX.length) : null;
}

export function isSkillToolOutput(value: unknown): value is SkillToolOutput {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.kind === "vantage_skill" &&
    typeof row.skill === "string" &&
    (row.status === "ok" || row.status === "empty" || row.status === "setup_required") &&
    typeof row.summary === "string"
  );
}

/**
 * Which tools run before the model, and which the model may choose, for one chat turn.
 *
 * - `forced` always runs first: a skill the person pinned (the "Using …" chip, or the page they
 *   opened Ask AI from), or the one the cheap keyword router matched.
 * - `fallback` is the deterministic planner's list. With a provider that calls tools itself it
 *   becomes a candidate list; otherwise it runs as before.
 * - `nativeCandidates` are offered to such a provider only (every other skill the person may
 *   use), so the model can pick a skill the keywords missed. Without native tools they never run.
 */
export function planTurnTools(input: {
  forced: PlannedToolCall[];
  fallback: PlannedToolCall[];
  nativeCandidates: string[];
  /** The caller named the exact tool calls (`toolCalls`); nothing else is planned. */
  explicit: boolean;
  supportsNativeTools: boolean;
}): {
  native: boolean;
  /** Run these before the first model call. */
  upFront: PlannedToolCall[];
  /** Offered to a native-tool provider. Empty when not native. */
  candidateNames: string[];
  /** Everything this turn may run: for policy checks, the run record, and billing. */
  planned: PlannedToolCall[];
} {
  if (input.explicit) {
    return { native: false, upFront: input.fallback, candidateNames: [], planned: input.fallback };
  }
  const forcedNames = new Set(input.forced.map((call) => call.name));
  const fallback = input.fallback.filter((call) => !forcedNames.has(call.name));
  const fallbackNames = new Set(fallback.map((call) => call.name));
  const nativeOnly = [...new Set(input.nativeCandidates)].filter(
    (name) => !forcedNames.has(name) && !fallbackNames.has(name),
  );
  const candidateNames = [...fallbackNames, ...nativeOnly];
  const native = input.supportsNativeTools && candidateNames.length > 0;
  return {
    native,
    upFront: native ? input.forced : [...input.forced, ...fallback],
    candidateNames: native ? candidateNames : [],
    planned: [...input.forced, ...fallback],
  };
}
