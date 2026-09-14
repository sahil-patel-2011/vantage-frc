// Pure, framework-free helpers for the Pick-list auto-justifier & contradiction guard.
// Conversion helpers are unit-testable with plain inputs. The Pick Clock read
// loader (loadStoredJustificationsForPickClock) is re-exported from
// ./pick-clock-reasons for the clock to import — do not teach pick-clock-board.ts
// how to parse justifier rows.

import type {
  ComputedJustification,
  JustificationInput,
  PicklistContradiction,
  PicklistSourceRef,
} from "./types";

const CONFIDENCE_SCORE: Record<string, number> = { high: 1, normal: 0.5, low: 0 };

export function confidenceScore(confidence: string): number {
  return CONFIDENCE_SCORE[confidence] ?? 0.5;
}

export function averageConfidence(confidences: string[]): number | null {
  if (!confidences.length) return null;
  const sum = confidences.reduce((acc, value) => acc + confidenceScore(value), 0);
  return Math.round((sum / confidences.length) * 100) / 100;
}

export function winRate(wins: number, losses: number, ties: number): number | null {
  const total = wins + losses + ties;
  if (total <= 0) return null;
  return Math.round(((wins + ties * 0.5) / total) * 100) / 100;
}

/** A pick "leans on" scouting when there is no official row, or scouts are confident despite a weak official record. */
export function detectContradiction(input: JustificationInput): PicklistContradiction {
  const { tba, scout } = input;
  if (scout.entryCount === 0) return { flagged: false, reason: null };

  if (!tba) {
    return { flagged: false, reason: null };
  }

  const rate = winRate(tba.wins, tba.losses, tba.ties);
  const confident = (scout.avgConfidenceScore ?? 0) >= 0.5;
  const mostlyLowConfidence = scout.entryCount > 0 && scout.lowConfidenceCount / scout.entryCount >= 0.5;

  if (rate != null && rate < 0.35 && confident && !mostlyLowConfidence) {
    return {
      flagged: true,
      reason: `Scouts logged this pick with average-or-higher confidence, but the official record shows a ${Math.round(
        rate * 100,
      )}% win rate (${tba.wins}-${tba.losses}-${tba.ties}) at this event.`,
    };
  }

  return { flagged: false, reason: null };
}

export function buildSources(input: JustificationInput): PicklistSourceRef[] {
  const sources: PicklistSourceRef[] = [];
  if (input.tba) {
    const parts: string[] = [];
    if (input.tba.epaTotal != null) parts.push(`Rating ${input.tba.epaTotal.toFixed(1)}`);
    if (input.tba.rank != null) parts.push(`rank ${input.tba.rank}`);
    parts.push(`${input.tba.wins}-${input.tba.losses}-${input.tba.ties}`);
    sources.push({
      kind: "hard_metric",
      label: "Official record",
      detail: parts.join(" · "),
    });
  }
  if (input.scout.entryCount > 0) {
    const conf = input.scout.avgConfidenceScore != null ? `${Math.round(input.scout.avgConfidenceScore * 100)}% avg confidence` : "confidence unrecorded";
    sources.push({
      kind: "scout_observation",
      label: "Team scouting",
      detail: `${input.scout.entryCount} scouted match${input.scout.entryCount === 1 ? "" : "es"} · ${conf}`,
    });
  }
  return sources;
}

export function buildRationaleText(input: JustificationInput, contradiction: PicklistContradiction): string {
  const label = input.teamNumber ? `Team ${input.teamNumber}` : input.teamKey;
  const parts: string[] = [`${label} is ranked #${input.rank}${input.tier ? ` (${input.tier})` : ""} on this pick list.`];

  if (input.tba) {
    const rate = winRate(input.tba.wins, input.tba.losses, input.tba.ties);
    const epa = input.tba.epaTotal != null ? `a rating of ${input.tba.epaTotal.toFixed(1)}` : "no recorded rating";
    const rank = input.tba.rank != null ? `, ranked ${input.tba.rank} at the event` : "";
    parts.push(
      `The official record shows ${epa}${rank} and a ${input.tba.wins}-${input.tba.losses}-${input.tba.ties} match record${
        rate != null ? ` (${Math.round(rate * 100)}% win rate)` : ""
      }.`,
    );
  } else {
    parts.push("No official match-record data is available yet for this team at this event.");
  }

  if (input.scout.entryCount > 0) {
    parts.push(
      `This org's scouts logged ${input.scout.entryCount} match${input.scout.entryCount === 1 ? "" : "es"} on this team.`,
    );
  } else {
    parts.push("No scouting entries have been logged for this team at this event yet.");
  }

  if (contradiction.flagged && contradiction.reason) {
    parts.push(`Contradiction flagged: ${contradiction.reason}`);
  }

  return parts.join(" ");
}

export function computeJustification(input: JustificationInput): ComputedJustification {
  const contradiction = detectContradiction(input);
  return {
    rationale: buildRationaleText(input, contradiction),
    sources: buildSources(input),
    contradiction,
  };
}

export function picklistTierLabel(tier: string | null): string {
  if (!tier) return "Unranked tier";
  return tier
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

export {
  applyStoredJustificationToRecommendation,
  applyStoredJustificationsToPickClockResult,
  glanceableLabel,
  loadStoredJustificationsForPickClock,
  mergePickClockReasons,
  parseJustificationSources,
  pickClockReasonsByTeam,
  pickClockReasonsFromJustification,
  resolveJustifierPickListId,
  storedJustificationFromEntry,
} from "./pick-clock-reasons";
export type {
  PickClockJustificationReason,
  PickClockReasonCarrier,
  PickClockResultCarrier,
  StoredJustificationIndex,
  StoredPicklistJustification,
} from "./pick-clock-reasons";
