import type { StrategyView } from "../strategy/types";
import { studentRatingLabel } from "./student-rating-label";

type LiveStrategy = Extract<StrategyView, { status: "live" }>;

function studentFactor<T extends { name: string; evidence: string }>(factor: T): T {
  return {
    ...factor,
    name: studentRatingLabel(factor.name),
    evidence: studentRatingLabel(factor.evidence),
  };
}

/**
 * Rewrite leftover stored rating / official-match / MODEL strings on a live
 * Strategy view after cache-source filtering. Do not rewrite `sources[].source`
 * — tba / statbotics stay identifiers for the cached-source helper.
 */
export function studentLiveStrategyCopy(view: LiveStrategy): LiveStrategy {
  return {
    ...view,
    prediction: {
      ...view.prediction,
      keyFactors: view.prediction.keyFactors.map(studentFactor),
      caveats: view.prediction.caveats.map(studentRatingLabel),
      reasoningSteps: view.prediction.reasoningSteps?.map((step) => ({
        ...step,
        title: studentRatingLabel(step.title),
        detail: studentRatingLabel(step.detail),
      })),
      citations: view.prediction.citations?.map((citation) => ({
        ...citation,
        summary: studentRatingLabel(citation.summary),
      })),
    },
    allianceBreakdown: {
      ...view.allianceBreakdown,
      keyFactors: view.allianceBreakdown.keyFactors.map(studentFactor),
      caveats: view.allianceBreakdown.caveats.map(studentRatingLabel),
      citations: view.allianceBreakdown.citations.map((citation) => ({
        ...citation,
        summary: studentRatingLabel(citation.summary),
      })),
    },
    playbook: {
      ...view.playbook,
      strengthsToProtect: view.playbook.strengthsToProtect.map(studentRatingLabel),
      risksToMitigate: view.playbook.risksToMitigate.map(studentRatingLabel),
      provenance: view.playbook.provenance.map(studentRatingLabel),
    },
    matchup: {
      ...view.matchup,
      considerations: view.matchup.considerations.map(studentRatingLabel),
    },
    tendencies: view.tendencies.map((item) => ({
      ...item,
      evidence: item.evidence.map(studentRatingLabel),
    })),
  };
}
