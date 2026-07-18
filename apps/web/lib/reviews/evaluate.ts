// Pure gate evaluation + review summary. Deterministic given its input.

import type {
  DesignReview,
  GateDecision,
  ReviewEvaluation,
  ReviewItem,
  ReviewStage,
  ReviewStatus,
  ReviewsSummary,
} from "./types";

const STAGE_ORDER: ReviewStage[] = ["concept", "preliminary", "critical", "final"];
const ALL_GATES: GateDecision[] = ["go", "conditional", "no_go", "pending"];

const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function reviewStageLabel(stage: ReviewStage): string {
  const labels: Record<ReviewStage, string> = {
    concept: "Concept",
    preliminary: "Preliminary",
    critical: "Critical",
    final: "Final",
  };
  return labels[stage];
}

export function reviewStatusLabel(status: ReviewStatus): string {
  const labels: Record<ReviewStatus, string> = {
    scheduled: "Scheduled",
    in_review: "In review",
    complete: "Complete",
    cancelled: "Cancelled",
  };
  return labels[status];
}

export function gateLabel(gate: GateDecision): string {
  const labels: Record<GateDecision, string> = {
    go: "Go",
    conditional: "Conditional go",
    no_go: "No-go",
    pending: "Pending",
  };
  return labels[gate];
}

/** Default criteria checklist for a review stage; some items are go/no-go blockers. */
export function stageBlueprint(stage: ReviewStage): Array<{ criterion: string; blocking: boolean }> {
  switch (stage) {
    case "concept":
      return [
        { criterion: "Problem and requirements clearly defined", blocking: true },
        { criterion: "Multiple concepts considered", blocking: false },
        { criterion: "Concept selection justified against criteria", blocking: true },
        { criterion: "Rough feasibility / risks identified", blocking: false },
      ];
    case "preliminary":
      return [
        { criterion: "Interfaces to adjacent subsystems defined", blocking: true },
        { criterion: "Rough CAD / layout complete", blocking: false },
        { criterion: "Weight and size budget checked", blocking: true },
        { criterion: "Prototype / test plan drafted", blocking: false },
        { criterion: "Key risks identified with mitigations", blocking: false },
      ];
    case "critical":
      return [
        { criterion: "Full CAD complete and checked", blocking: true },
        { criterion: "Tolerances and fits reviewed", blocking: false },
        { criterion: "Fabrication plan and BOM complete", blocking: true },
        { criterion: "Failure modes reviewed", blocking: false },
        { criterion: "Integration with adjacent subsystems verified", blocking: true },
      ];
    case "final":
    default:
      return [
        { criterion: "Meets all requirements", blocking: true },
        { criterion: "Manufactured and assembled", blocking: true },
        { criterion: "Tested to expected load / use", blocking: true },
        { criterion: "Rules-legal (weight, size, bumper)", blocking: true },
        { criterion: "Documented for build season and judges", blocking: false },
      ];
  }
}

function gateFor(items: ReviewItem[]): { gate: GateDecision; applicable: number; passed: number; failed: number; pending: number; na: number; blockingFails: number } {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let na = 0;
  let blockingFails = 0;
  for (const item of items) {
    switch (item.verdict) {
      case "pass":
        passed += 1;
        break;
      case "fail":
        failed += 1;
        if (item.blocking) blockingFails += 1;
        break;
      case "na":
        na += 1;
        break;
      default:
        pending += 1;
    }
  }
  const applicable = passed + failed + pending;
  let gate: GateDecision;
  if (blockingFails > 0) gate = "no_go";
  else if (pending > 0 || applicable === 0) gate = "pending";
  else if (failed > 0) gate = "conditional";
  else gate = "go";
  return { gate, applicable, passed, failed, pending, na, blockingFails };
}

export function evaluateReview(review: DesignReview): ReviewEvaluation {
  const { gate, applicable, passed, failed, pending, na, blockingFails } = gateFor(review.items ?? []);
  return {
    review,
    applicable,
    passed,
    failed,
    pending,
    na,
    blockingFails,
    readiness: applicable > 0 ? round(passed / applicable) : 0,
    gate,
  };
}

export function summarizeReviews(reviews: DesignReview[]): ReviewsSummary {
  const evaluations = reviews.map(evaluateReview);

  const byStage = STAGE_ORDER.reduce((acc, stage) => ({ ...acc, [stage]: 0 }), {} as Record<ReviewStage, number>);
  for (const e of evaluations) byStage[e.review.stage] += 1;

  const byGate = ALL_GATES.reduce((acc, gate) => ({ ...acc, [gate]: 0 }), {} as Record<GateDecision, number>);
  for (const e of evaluations) byGate[e.gate] += 1;

  const gateRank: Record<GateDecision, number> = { no_go: 0, pending: 1, conditional: 2, go: 3 };
  const needsAttention = evaluations
    .filter((e) => e.gate === "no_go" || e.gate === "pending")
    .sort((a, b) => gateRank[a.gate] - gateRank[b.gate] || a.readiness - b.readiness);

  const upcoming = evaluations
    .filter((e) => e.review.status === "scheduled" || e.review.status === "in_review")
    .sort((a, b) => (a.review.scheduledOn ?? "9999").localeCompare(b.review.scheduledOn ?? "9999"));

  const avgReadiness = evaluations.length > 0 ? round(evaluations.reduce((sum, e) => sum + e.readiness, 0) / evaluations.length) : 0;

  return { total: reviews.length, byStage, byGate, needsAttention, upcoming, avgReadiness };
}
