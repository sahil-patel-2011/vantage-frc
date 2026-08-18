// Pure, framework-free fix-vs-swap triage math. Everything here is deterministic and grounded
// only in the numbers the caller supplies (minutes until next match, spares on hand, prior FMEA
// failure count for the subsystem, and severity) — it never fabricates a value.
// compute-pit-repair-triage.ts wraps this with DB I/O; the API route and client render results.

import type { TriageDecision, TriageResult, TriageStatus } from "./types";

/** Below this many minutes until the next match, there is no time to diagnose/fix — swap. */
export const SWAP_TIME_THRESHOLD_MIN = 12;
/** At/above this many minutes, there is enough time to attempt a proper repair. */
export const FIX_TIME_THRESHOLD_MIN = 20;
/** Prior FMEA failures on this subsystem at/above this count are treated as a chronic issue. */
export const CHRONIC_FAILURE_COUNT = 3;
/** FMEA severity (1-10) at/below this is treated as low-severity/cosmetic. */
export const LOW_SEVERITY_THRESHOLD = 4;

export const TRIAGE_DECISIONS: TriageDecision[] = ["fix", "swap", "monitor"];
export const TRIAGE_STATUSES: TriageStatus[] = ["open", "staged", "resolved"];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function triageDecisionLabel(decision: TriageDecision): string {
  switch (decision) {
    case "fix":
      return "Fix in the pit";
    case "swap":
      return "Swap the spare";
    default:
      return "Monitor";
  }
}

export type TriageInput = {
  /** Minutes until this robot is due back on the field. */
  minutesUntilNextMatch: number;
  /** Units of a matched spare currently in inventory (0 if no spare is on hand / matched). */
  sparesAvailable: number;
  /** Count of prior FMEA failures logged against this subsystem this season. */
  priorFailureCount: number;
  /** FMEA severity (1-10) of the linked failure mode, or a reasonable default. */
  severity: number;
};

/** Core recommendation: repair the failed part, swap in a spare, or monitor a low-severity issue. */
export function triageRepair(input: TriageInput): TriageResult {
  const minutes = Math.max(0, Math.round(input.minutesUntilNextMatch));
  const spares = Math.max(0, input.sparesAvailable);
  const priorFailures = Math.max(0, Math.round(input.priorFailureCount));
  const severity = Math.min(10, Math.max(1, Math.round(input.severity) || 5));

  const hasSpare = spares > 0;
  const chronic = priorFailures >= CHRONIC_FAILURE_COUNT;
  const lowSeverity = severity <= LOW_SEVERITY_THRESHOLD;

  if (!hasSpare) {
    const confidence = round(clamp01(minutes >= FIX_TIME_THRESHOLD_MIN ? 0.75 : 0.4));
    return {
      decision: "fix",
      confidence,
      rationale: `No matched spare in stock — repair is the only option. ${minutes} min until the next match ${
        minutes < FIX_TIME_THRESHOLD_MIN ? "is tight for a full fix" : "is enough time to fix it"
      }.`,
      prestageRecommended: false,
    };
  }

  if (minutes < SWAP_TIME_THRESHOLD_MIN) {
    return {
      decision: "swap",
      confidence: round(clamp01(0.6 + ((SWAP_TIME_THRESHOLD_MIN - minutes) / SWAP_TIME_THRESHOLD_MIN) * 0.3)),
      rationale: `Only ${minutes} min until the next match — not enough time to diagnose and fix. Swap in the spare and pre-stage it now.`,
      prestageRecommended: true,
    };
  }

  if (chronic) {
    return {
      decision: "swap",
      confidence: round(clamp01(0.55 + Math.min(0.3, (priorFailures - CHRONIC_FAILURE_COUNT) * 0.05))),
      rationale: `This subsystem has failed ${priorFailures} time(s) before — a recurring/systemic issue. Swap the part instead of re-fixing the same failure mode; pre-stage the spare.`,
      prestageRecommended: true,
    };
  }

  if (minutes >= FIX_TIME_THRESHOLD_MIN && lowSeverity) {
    return {
      decision: "monitor",
      confidence: 0.5,
      rationale: `Low-severity issue (severity ${severity}/10) with ${minutes} min available — monitor it and only intervene if it worsens.`,
      prestageRecommended: false,
    };
  }

  if (minutes >= FIX_TIME_THRESHOLD_MIN) {
    return {
      decision: "fix",
      confidence: round(clamp01(0.55 + Math.min(0.25, (minutes - FIX_TIME_THRESHOLD_MIN) / 40))),
      rationale: `${minutes} min until the next match is enough time to diagnose and repair, and this subsystem has no chronic recurrence — fix it.`,
      prestageRecommended: false,
    };
  }

  return {
    decision: "swap",
    confidence: 0.5,
    rationale: `${minutes} min is borderline for a full fix — swap in the spare to guarantee readiness for the next match, then troubleshoot the failed part afterward.`,
    prestageRecommended: true,
  };
}

/**
 * CD inspectors (I104): a fix or swap changes the robot. Cue only while the report is still
 * open/staged — never invent that a resolved repair skipped reinspection.
 */
export function needsReinspectionBeforeQueue(input: {
  decision: TriageDecision;
  status: TriageStatus;
}): boolean {
  if (input.decision === "monitor") return false;
  return input.status === "open" || input.status === "staged";
}

export function reinspectionCue(input: {
  decision: TriageDecision;
  status: TriageStatus;
  subsystemName?: string;
}): string | null {
  if (!needsReinspectionBeforeQueue(input)) return null;
  const part = input.subsystemName?.trim() ? ` (${input.subsystemName.trim()})` : "";
  return `I104: get this repair${part} reinspected before you queue — playing a changed robot that did not pass inspection can DQ the match.`;
}

/** FRC: a tripped main breaker becomes more sensitive — replace it, do not keep resetting. */
export const MAIN_BREAKER_TRIP_CUE =
  "A tripped main breaker is more sensitive afterward — swap the packed spare before you queue.";

export function mainBreakerTripCue(input: {
  title?: string;
  symptomNote?: string;
  subsystemName?: string;
  status: TriageStatus;
}): string | null {
  if (input.status === "resolved") return null;
  const hay = `${input.title ?? ""} ${input.symptomNote ?? ""} ${input.subsystemName ?? ""}`.toLowerCase();
  if (!/main breaker|breaker trip/.test(hay)) return null;
  return MAIN_BREAKER_TRIP_CUE;
}

/** CD CAN thread: missing far-end 120Ω looks like random dropouts. Cue only a logged CAN symptom. */
export const CAN_BUS_DROPOUT_CUE =
  "CAN dropouts often mean missing far-end termination — meter yellow-to-green ~60Ω with the battery out (roboRIO 120Ω + PDH jumper or a 120Ω resistor).";

export function canBusDropoutCue(input: {
  title?: string;
  symptomNote?: string;
  subsystemName?: string;
  status: TriageStatus;
}): string | null {
  if (input.status === "resolved") return null;
  const hay = `${input.title ?? ""} ${input.symptomNote ?? ""} ${input.subsystemName ?? ""}`.toLowerCase();
  if (!/can bus|can drop|can timeout|can fault|unterminat|120\s*ohm|terminator/.test(hay)) return null;
  return CAN_BUS_DROPOUT_CUE;
}
