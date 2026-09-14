// Pure, unit-testable helpers for the alliance-partner brief. No I/O.

import type { PartnerEpa, PartnerRole } from "./types";

export const PARTNER_ROLE_LABEL: Record<PartnerRole, string> = {
  auto_specialist: "Auto specialist",
  teleop_scorer: "Teleop scorer",
  endgame_specialist: "Endgame specialist",
  balanced_scorer: "Balanced scorer",
  defense_support: "Defense / support",
  unproven: "Unproven — no event data yet",
};

/**
 * Classifies the partner's on-field role from real season-rating breakdown numbers only.
 * Returns "unproven" when there is no metrics source at all — never guesses.
 */
export function classifyPartnerRole(epa: PartnerEpa | null): PartnerRole {
  if (!epa || epa.epaTotal == null) return "unproven";
  const auto = epa.epaAuto ?? 0;
  const teleop = epa.epaTeleop ?? 0;
  const endgame = epa.epaEndgame ?? 0;
  const total = auto + teleop + endgame;
  if (total <= 0) return "unproven";

  const autoShare = auto / total;
  const teleopShare = teleop / total;
  const endgameShare = endgame / total;

  if (endgameShare >= 0.3 && endgame >= auto && endgame >= teleop) return "endgame_specialist";
  if (autoShare >= 0.4 && auto >= teleop) return "auto_specialist";
  if (teleopShare >= 0.55) return "teleop_scorer";
  // Balanced spread across phases with no clear scoring peak reads as a support/defense role.
  const spread = Math.max(autoShare, teleopShare, endgameShare) - Math.min(autoShare, teleopShare, endgameShare);
  if (spread < 0.15) return "defense_support";
  return "balanced_scorer";
}

/**
 * Builds a short list of strength statements from real season ratings and scouting coverage.
 * Every line cites the number that produced it — no invented claims.
 */
export function buildPartnerStrengths(
  epa: PartnerEpa | null,
  matchScoutEntryCount: number,
  pitScoutEntryCount: number,
): string[] {
  const strengths: string[] = [];
  if (epa) {
    if (epa.epaTotal != null) strengths.push(`Season rating ${epa.epaTotal.toFixed(1)}`);
    if (epa.epaAuto != null && epa.epaAuto > 0) strengths.push(`Auto rating ${epa.epaAuto.toFixed(1)}`);
    if (epa.epaTeleop != null && epa.epaTeleop > 0) strengths.push(`Teleop rating ${epa.epaTeleop.toFixed(1)}`);
    if (epa.epaEndgame != null && epa.epaEndgame > 0) strengths.push(`Endgame rating ${epa.epaEndgame.toFixed(1)}`);
    if (epa.rank != null) strengths.push(`Event rank #${epa.rank}`);
    const played = epa.wins + epa.losses + epa.ties;
    if (played > 0) strengths.push(`${epa.wins}-${epa.losses}-${epa.ties} at this event`);
  }
  if (matchScoutEntryCount > 0) {
    strengths.push(`${matchScoutEntryCount} of our own match-scout entr${matchScoutEntryCount === 1 ? "y" : "ies"}`);
  }
  if (pitScoutEntryCount > 0) {
    strengths.push(`Pit-scouted by our team (${pitScoutEntryCount} entr${pitScoutEntryCount === 1 ? "y" : "ies"})`);
  }
  return strengths;
}

export function buildEvidenceNote(
  epa: PartnerEpa | null,
  matchScoutEntryCount: number,
  pitScoutEntryCount: number,
): string {
  const hasMetrics = epa != null && epa.epaTotal != null;
  const hasScouting = matchScoutEntryCount > 0 || pitScoutEntryCount > 0;
  if (hasMetrics && hasScouting) return "Event metrics + our own scouting";
  if (hasMetrics) return "Event metrics only — no scouting logged for this team yet";
  if (hasScouting) return "Our own scouting only — no event metrics synced yet";
  return "No event metrics or scouting on file yet";
}

export function alliancePartnerBriefRoleLabel(role: PartnerRole): string {
  return PARTNER_ROLE_LABEL[role];
}
