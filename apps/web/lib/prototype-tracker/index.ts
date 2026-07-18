// Pure, framework-free decision-drafting math. Everything here is deterministic and grounded
// only in the values the caller supplies (the test's outcome, hypothesis, result summary, and
// metric-vs-target) — it never fabricates a value.
// compute-prototype-tracker.ts wraps this with DB I/O + metering; the API route and client render results.

import type { DecisionDraft, DecisionRecommendation, DecisionStatus, TestOutcome } from "./types";

export const TEST_OUTCOMES: TestOutcome[] = ["success", "failure", "inconclusive", "partial"];
export const DECISION_RECOMMENDATIONS: DecisionRecommendation[] = [
  "adopt",
  "iterate",
  "reject",
  "needs_more_data",
];
export const DECISION_STATUSES: DecisionStatus[] = ["draft", "finalized"];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function testOutcomeLabel(outcome: TestOutcome): string {
  switch (outcome) {
    case "success":
      return "Success";
    case "failure":
      return "Failure";
    case "partial":
      return "Partial success";
    default:
      return "Inconclusive";
  }
}

export function decisionRecommendationLabel(recommendation: DecisionRecommendation): string {
  switch (recommendation) {
    case "adopt":
      return "Adopt";
    case "iterate":
      return "Iterate";
    case "reject":
      return "Reject";
    default:
      return "Needs more data";
  }
}

/** How close the recorded metric came to its target, in [0,1] (1 = met/exceeded target). */
function metricAttainment(metricValue: number | null, metricTarget: number | null): number | null {
  if (metricValue == null || metricTarget == null || metricTarget === 0) return null;
  return clamp01(metricValue / metricTarget);
}

export type DecisionDraftInput = {
  subsystemName: string;
  title: string;
  hypothesis: string;
  outcome: TestOutcome;
  resultSummary: string;
  metricLabel: string | null;
  metricValue: number | null;
  metricTarget: number | null;
};

/** Core recommendation + drafted decision record / notebook entry, grounded only in the test's own fields. */
export function draftDecision(input: DecisionDraftInput): DecisionDraft {
  const attainment = metricAttainment(input.metricValue, input.metricTarget);
  const hasMetric = input.metricLabel != null && input.metricValue != null && input.metricTarget != null;
  const metricLine = hasMetric
    ? `${input.metricLabel}: ${input.metricValue} (target ${input.metricTarget}, ${Math.round((attainment ?? 0) * 100)}% of target).`
    : "";

  let recommendation: DecisionRecommendation;
  let confidence: number;

  if (input.outcome === "success" && (attainment == null || attainment >= 1)) {
    recommendation = "adopt";
    confidence = round(clamp01(0.7 + (attainment != null ? (attainment - 1) * 0.2 : 0)));
  } else if (input.outcome === "failure") {
    recommendation = "reject";
    confidence = round(clamp01(0.7 + (attainment != null ? (0.5 - attainment) * 0.3 : 0)));
  } else if (input.outcome === "partial" || (attainment != null && attainment >= 0.7 && attainment < 1)) {
    recommendation = "iterate";
    confidence = round(clamp01(0.5 + (attainment != null ? attainment * 0.2 : 0)));
  } else {
    recommendation = "needs_more_data";
    confidence = 0.4;
  }

  const decisionRecord = [
    `Decision: ${decisionRecommendationLabel(recommendation)} — ${input.subsystemName}: ${input.title}.`,
    input.hypothesis ? `Hypothesis: ${input.hypothesis}` : "",
    `Outcome: ${testOutcomeLabel(input.outcome)}.${input.resultSummary ? ` ${input.resultSummary}` : ""}`,
    metricLine,
    `Confidence: ${Math.round(confidence * 100)}%, based only on the recorded test outcome${hasMetric ? " and metric" : ""}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const notebookEntry = [
    `## ${input.subsystemName} — ${input.title}`,
    input.hypothesis ? `**Hypothesis:** ${input.hypothesis}` : "",
    `**Outcome:** ${testOutcomeLabel(input.outcome)}`,
    input.resultSummary ? `**Result:** ${input.resultSummary}` : "",
    hasMetric ? `**Metric:** ${metricLine}` : "",
    `**Decision:** ${decisionRecommendationLabel(recommendation)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { recommendation, confidence, decisionRecord, notebookEntry };
}
