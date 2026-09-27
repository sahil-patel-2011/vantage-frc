/**
 * What the robots on screen are worth *together*.
 *
 * Comparing two robots column by column answers "which is better". An alliance
 * captain is asking something else: what does this pairing score, how bad can
 * its bad day be, and do the two robots do the same job or different ones. Two
 * 40-point robots that both ignore auto are a worse alliance than a 35 and a 40
 * that split the field between them.
 *
 * Arithmetic only — sums, shares and rates over numbers the scouting engine
 * already produced. Nothing is modelled or predicted, so this is as trustworthy
 * as the matches the team actually watched, and it works offline.
 */

import type { ScoutedTeamProfile } from "@vantage/prediction-strategy";
import { completePhaseBreakdown, phasePointValue } from "./scouting-points-display";

export type AllianceMath = {
  /** Sum of the shrunk per-match totals. */
  total: number;
  /** Summed bad day and good day, when every robot has a spread. */
  floor: number | null;
  ceiling: number | null;
  /** Points per phase, summed. */
  auto: number | null;
  teleop: number | null;
  endgame: number | null;
  /** Chance at least one robot is dead in a given match, if rates are independent. */
  deadRisk: number;
  /** Robots with a recorded climb rate above half their matches. */
  climbers: number;
  /** How differently the robots spend their points, 0 (identical) to 1 (opposite). */
  complementarity: number | null;
  /** The sentence a captain repeats out loud. */
  note: string;
};

function phaseShares(profile: ScoutedTeamProfile): [number, number, number] {
  const total = profile.meanAuto + profile.meanTeleop + profile.meanEndgame;
  if (total <= 0) return [0, 0, 0];
  return [profile.meanAuto / total, profile.meanTeleop / total, profile.meanEndgame / total];
}

/**
 * Average pairwise distance between the robots' phase mixes.
 *
 * Half the sum of absolute share differences is 0 when two robots spend their
 * points identically and 1 when they have no phase in common, which is exactly
 * the reading a captain wants from the word "complementary".
 */
function complementarityOf(profiles: readonly ScoutedTeamProfile[]): number {
  const shares = profiles.map(phaseShares);
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < shares.length; i += 1) {
    for (let j = i + 1; j < shares.length; j += 1) {
      const a = shares[i]!;
      const b = shares[j]!;
      sum += (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 2;
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

const PHASE_NAMES = ["auto", "teleop", "endgame"] as const;

function strongestPhase(profile: ScoutedTeamProfile): (typeof PHASE_NAMES)[number] {
  const shares = phaseShares(profile);
  let best = 0;
  for (let i = 1; i < shares.length; i += 1) if (shares[i]! > shares[best]!) best = i;
  return PHASE_NAMES[best]!;
}

function teamNumber(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

export function allianceMath(profiles: readonly ScoutedTeamProfile[]): AllianceMath | null {
  if (profiles.length < 2) return null;

  const total = profiles.reduce((sum, profile) => sum + profile.shrunkTotal, 0);
  const everySpread = profiles.every((profile) => profile.consistency?.floor != null);
  const floor = everySpread
    ? profiles.reduce((sum, profile) => sum + (profile.consistency?.floor ?? 0), 0)
    : null;
  const ceiling = everySpread
    ? profiles.reduce((sum, profile) => sum + (profile.consistency?.ceiling ?? 0), 0)
    : null;
  const deadRisk =
    1 - profiles.reduce((live, profile) => live * (1 - Math.min(Math.max(profile.disabledRate, 0), 1)), 1);
  const climbers = profiles.filter((profile) => (profile.climbRate ?? 0) > 0.5).length;
  const allPhasesObserved = profiles.every(completePhaseBreakdown);
  const complementarity = allPhasesObserved ? complementarityOf(profiles) : null;

  const numbers = profiles.map((profile) => teamNumber(profile.teamKey));
  const mixes = profiles.map(strongestPhase);
  const sameJob = new Set(mixes).size === 1;
  const note = !allPhasesObserved ? "A complete phase split is missing. Assign roles using recorded capabilities and raw reports." : sameJob
    ? profiles.length === 2
      ? `Both lean on ${mixes[0]}. Their strengths overlap; consider a third robot with complementary capabilities.`
      : `All ${profiles.length} robots lean on ${mixes[0]}. Their strengths overlap; check whether the alliance covers the other scoring roles.`
    : `${profiles
        .map((profile, index) => `${numbers[index]} carries ${mixes[index]}`)
        .join(", ")} — the jobs are split.`;

  return {
    total,
    floor,
    ceiling,
    auto: profiles.some(profile => phasePointValue(profile, "auto") == null) ? null : profiles.reduce((sum, profile) => sum + profile.meanAuto, 0),
    teleop: profiles.some(profile => phasePointValue(profile, "teleop") == null) ? null : profiles.reduce((sum, profile) => sum + profile.meanTeleop, 0),
    endgame: profiles.some(profile => phasePointValue(profile, "endgame") == null) ? null : profiles.reduce((sum, profile) => sum + profile.meanEndgame, 0),
    deadRisk,
    climbers,
    complementarity,
    note,
  };
}
