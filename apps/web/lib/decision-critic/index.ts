// Pure, framework-free devil's-advocate critique math. Everything here is deterministic and
// grounded only in the numbers the caller supplies (weight margin, power headroom, chronic FMEA
// failure count for the subsystem, and prior rejected/superseded decisions in the same category)
// — it never fabricates a value. compute-decision-critic.ts wraps this with DB I/O; the API route
// and client render results.

import type { CriticResult, DecisionCriticOutcome, DecisionCriticVerdict } from "./types";

/** Below this many pounds of remaining margin (after the addition), flag it as tight. */
export const WEIGHT_TIGHT_MARGIN_LBS = 3;
/** Below this many amps of remaining headroom (after the addition), flag it as tight. */
export const POWER_TIGHT_HEADROOM_AMPS = 5;
/** Prior FMEA failures on this subsystem at/above this count are treated as a recurring/chronic issue. */
export const CHRONIC_FAILURE_THRESHOLD = 2;

export const DECISION_CRITIC_CATEGORIES = ["design", "strategy", "build", "process", "other"] as const;
export const DECISION_CRITIC_VERDICTS: DecisionCriticVerdict[] = [
  "proceed",
  "proceed_with_caution",
  "reconsider",
];
export const DECISION_CRITIC_OUTCOMES: DecisionCriticOutcome[] = [
  "open",
  "proceeded",
  "revised",
  "abandoned",
];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function decisionVerdictLabel(verdict: DecisionCriticVerdict): string {
  switch (verdict) {
    case "proceed":
      return "Proceed";
    case "proceed_with_caution":
      return "Proceed with caution";
    default:
      return "Reconsider";
  }
}

export function decisionOutcomeLabel(outcome: DecisionCriticOutcome): string {
  switch (outcome) {
    case "proceeded":
      return "Proceeded as planned";
    case "revised":
      return "Revised the design";
    case "abandoned":
      return "Abandoned the idea";
    default:
      return "Open";
  }
}

export type CritiqueInput = {
  /** Pounds this decision would add to the robot. */
  weightAddedLbs: number;
  /** Remaining weight margin (limit - current total) BEFORE this addition. */
  weightMarginLbs: number;
  /** Amps this decision would add to the power budget. */
  powerAddedAmps: number;
  /** Remaining power headroom (breaker capacity - current peak draw) BEFORE this addition. */
  powerHeadroomAmps: number;
  /** Count of prior FMEA failures logged against this subsystem. */
  chronicFailureCount: number;
  /** Count of prior decisions in this category/subsystem that were rejected or superseded. */
  priorRejectedCount: number;
};

/** Core devil's-advocate verdict: proceed, proceed with caution, or reconsider — with rationale. */
export function critiqueDecision(input: CritiqueInput): CriticResult {
  const weightAdded = Math.max(0, input.weightAddedLbs);
  const powerAdded = Math.max(0, input.powerAddedAmps);
  const chronicFailureCount = Math.max(0, Math.round(input.chronicFailureCount));
  const priorRejectedCount = Math.max(0, Math.round(input.priorRejectedCount));

  const concerns: string[] = [];
  let severe = false;

  const weightAfter = round(input.weightMarginLbs - weightAdded);
  if (weightAfter < 0) {
    concerns.push(
      `Adding ${weightAdded} lb exceeds the remaining weight margin (${round(input.weightMarginLbs)} lb) by ${round(Math.abs(weightAfter))} lb.`,
    );
    severe = true;
  } else if (weightAfter < WEIGHT_TIGHT_MARGIN_LBS) {
    concerns.push(`Weight margin will be tight after this change — only ${weightAfter} lb remaining.`);
  }

  const powerAfter = round(input.powerHeadroomAmps - powerAdded);
  if (powerAfter < 0) {
    concerns.push(
      `Adding ${powerAdded} A exceeds the remaining power headroom (${round(input.powerHeadroomAmps)} A) by ${round(Math.abs(powerAfter))} A.`,
    );
    severe = true;
  } else if (powerAfter < POWER_TIGHT_HEADROOM_AMPS) {
    concerns.push(`Power headroom will be tight after this change — only ${powerAfter} A remaining.`);
  }

  if (chronicFailureCount >= CHRONIC_FAILURE_THRESHOLD) {
    concerns.push(
      `This subsystem has ${chronicFailureCount} prior FMEA failure(s) on record — a recurring failure mode worth re-examining before committing.`,
    );
  }

  if (priorRejectedCount > 0) {
    concerns.push(
      `${priorRejectedCount} similar decision(s) for this subsystem/category were previously rejected or superseded — check what changed.`,
    );
  }

  if (concerns.length === 0) {
    return {
      verdict: "proceed",
      confidence: 0.6,
      concerns: [],
      recommendation:
        "No grounded concerns found in weight/power headroom, FMEA history, or prior decisions — proceed.",
    };
  }

  const verdict: DecisionCriticVerdict = severe ? "reconsider" : "proceed_with_caution";
  const confidence = round(clamp01(0.4 + concerns.length * 0.12 + (severe ? 0.2 : 0)));
  const recommendation = severe
    ? "Resolve the exceeded margin(s) above before committing to this decision."
    : "Proceed only if the tight margins and/or history above are explicitly accepted and monitored.";

  return { verdict, confidence, concerns, recommendation };
}
