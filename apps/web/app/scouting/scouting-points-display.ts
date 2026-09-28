import type { ScoutedTeamProfile } from "@vantage/prediction-strategy";

export type PointPhase = "auto" | "teleop" | "endgame";

export function phasePointValue(profile: ScoutedTeamProfile, phase: PointPhase): number | null {
  if (profile.phaseSamples?.[phase] === 0) return null;
  return phase === "auto" ? profile.meanAuto : phase === "teleop" ? profile.meanTeleop : profile.meanEndgame;
}

export function phaseSampleCount(profile: ScoutedTeamProfile, phase: PointPhase): number {
  return profile.phaseSamples?.[phase] ?? profile.matches;
}

/** A share chart requires all phases over the same matches and a consistent total. */
export function completePhaseBreakdown(profile: ScoutedTeamProfile): boolean {
  return (["auto", "teleop", "endgame"] as const).every(phase => phaseSampleCount(profile, phase) === profile.matches)
    && Math.abs(profile.meanAuto + profile.meanTeleop + profile.meanEndgame - profile.meanTotal) < 0.000001;
}

export function pointValue(value: number | null): string {
  return value == null ? "Unknown" : value.toFixed(1);
}
