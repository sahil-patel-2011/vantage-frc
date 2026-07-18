// Pure, framework-free defensive-matchup math. Everything here is deterministic and
// grounded only in the numbers the caller supplies (our robot profile + the opponent's
// scouted cycle) — it never fabricates a value. compute-defense-planner.ts wraps this
// with DB I/O; the API route and client render the results.

import type {
  AssignedDefender,
  DefensePlan,
  DefenseRecommendation,
  DrivetrainType,
} from "./types";

export const DRIVETRAIN_TYPES: DrivetrainType[] = ["west_coast", "swerve", "mecanum", "tank", "other"];

/** Relative agility/pushing-contest multiplier by drivetrain archetype. 1.0 is baseline (west coast). */
export const DRIVETRAIN_MOBILITY: Record<DrivetrainType, number> = {
  swerve: 1.15,
  west_coast: 1.0,
  mecanum: 0.9,
  tank: 0.85,
  other: 1.0,
};

/** Points/min worth of denial above which defense is clearly worth assigning a robot to. */
export const DENIAL_VALUE_HIGH = 15;
/** Points/min below which defense isn't worth the opportunity cost of one fewer scorer. */
export const DENIAL_VALUE_LOW = 6;
/** Mass-ratio × mobility-ratio at/above which we can reliably contain the opponent. */
export const CONTAINMENT_THRESHOLD = 1.0;

export function drivetrainLabel(drivetrain: DrivetrainType): string {
  switch (drivetrain) {
    case "west_coast":
      return "West coast drive";
    case "swerve":
      return "Swerve";
    case "mecanum":
      return "Mecanum";
    case "tank":
      return "Tank / KOP";
    default:
      return "Other";
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** How many scoring cycles the opponent completes per minute at their scouted cycle time. */
export function cyclesPerMinute(cycleTimeSec: number): number {
  if (!Number.isFinite(cycleTimeSec) || cycleTimeSec <= 0) return 0;
  return 60 / cycleTimeSec;
}

/** Points/minute the opponent generates uninterrupted — the value of denying them a cycle. */
export function denialValuePerMinute(cycleTimeSec: number, avgPointsPerCycle: number): number {
  if (!Number.isFinite(avgPointsPerCycle) || avgPointsPerCycle < 0) return 0;
  return round(cyclesPerMinute(cycleTimeSec) * avgPointsPerCycle, 2);
}

/** Our mass over theirs — > 1 means we outweigh them in a pushing contest. */
export function massRatio(ourMassLbs: number, theirMassLbs: number): number {
  if (!Number.isFinite(theirMassLbs) || theirMassLbs <= 0) return 1;
  if (!Number.isFinite(ourMassLbs) || ourMassLbs <= 0) return 0;
  return round(ourMassLbs / theirMassLbs, 3);
}

/**
 * Composite ability to contain the opponent: mass advantage scaled by our relative
 * mobility vs theirs. >= CONTAINMENT_THRESHOLD means we can reliably stay in front of
 * and push/box out their cycle path.
 */
export function containmentScore(
  ourMassLbs: number,
  ourDrivetrain: DrivetrainType,
  theirMassLbs: number,
  theirDrivetrain: DrivetrainType,
): number {
  const mobilityRatio = DRIVETRAIN_MOBILITY[ourDrivetrain] / DRIVETRAIN_MOBILITY[theirDrivetrain];
  return round(massRatio(ourMassLbs, theirMassLbs) * mobilityRatio, 3);
}

export type RecommendDefenseInput = {
  ourMassLbs: number;
  ourDrivetrain: DrivetrainType;
  theirMassLbs: number;
  theirDrivetrain: DrivetrainType;
  theirCycleTimeSec: number;
  theirAvgPointsPerCycle: number;
  opponentTeamNumber?: number | null;
  opponentCyclePath?: string | null;
};

function buildRationale(
  input: RecommendDefenseInput,
  denial: number,
  containment: number,
  recommendation: DefenseRecommendation,
): string {
  const opponent = input.opponentTeamNumber ? `Team ${input.opponentTeamNumber}` : "This opponent";
  const path = input.opponentCyclePath?.trim();
  const cycleDesc = `${input.theirCycleTimeSec.toFixed(1)}s cycles worth ~${input.theirAvgPointsPerCycle} pts (≈${denial.toFixed(1)} pts/min uncontested)`;
  const massDesc = `${input.ourMassLbs} lb ${drivetrainLabel(input.ourDrivetrain).toLowerCase()} vs ${input.theirMassLbs} lb ${drivetrainLabel(input.theirDrivetrain).toLowerCase()} (containment score ${containment.toFixed(2)})`;
  const pathNote = path ? ` Scouted cycle path: ${path}.` : "";

  if (recommendation === "play_defense") {
    return `${opponent} runs ${cycleDesc}, high enough to justify denial. Our ${massDesc} gives us the mass/mobility edge to contain them — assign a robot to defense.${pathNote}`;
  }
  if (recommendation === "stay_offense") {
    return `${opponent} runs ${cycleDesc}, too low-value to give up a scorer for. Stay on offense and let the cycle run.${pathNote}`;
  }
  return `${opponent} runs ${cycleDesc}. Our ${massDesc} is close to the containment threshold — defense is situational: worth it only if we're otherwise idle or the game state calls for it.${pathNote}`;
}

/** Core recommendation: whether/whom to play defense against a single scouted opponent. */
export function recommendDefensePlan(input: RecommendDefenseInput): DefensePlan {
  const denial = denialValuePerMinute(input.theirCycleTimeSec, input.theirAvgPointsPerCycle);
  const containment = containmentScore(
    input.ourMassLbs,
    input.ourDrivetrain,
    input.theirMassLbs,
    input.theirDrivetrain,
  );

  let recommendation: DefenseRecommendation;
  let assignedDefender: AssignedDefender;
  let confidence: number;

  if (denial >= DENIAL_VALUE_HIGH && containment >= CONTAINMENT_THRESHOLD) {
    recommendation = "play_defense";
    assignedDefender = "us";
    confidence = round(
      clamp01(0.5 + Math.min(0.25, (containment - 1) * 0.25) + Math.min(0.22, (denial - DENIAL_VALUE_HIGH) / 40)),
      3,
    );
  } else if (denial < DENIAL_VALUE_LOW) {
    recommendation = "stay_offense";
    assignedDefender = "none";
    confidence = round(clamp01(0.5 + ((DENIAL_VALUE_LOW - denial) / DENIAL_VALUE_LOW) * 0.4), 3);
  } else {
    recommendation = "situational";
    assignedDefender = "situational";
    confidence = 0.45;
  }

  return {
    denialValuePerMinute: denial,
    massRatio: massRatio(input.ourMassLbs, input.theirMassLbs),
    containmentScore: containment,
    recommendation,
    assignedDefender,
    confidence,
    rationale: buildRationale(input, denial, containment, recommendation),
  };
}

export function defenseRecommendationLabel(recommendation: DefenseRecommendation): string {
  switch (recommendation) {
    case "play_defense":
      return "Play defense";
    case "stay_offense":
      return "Stay on offense";
    default:
      return "Situational";
  }
}
