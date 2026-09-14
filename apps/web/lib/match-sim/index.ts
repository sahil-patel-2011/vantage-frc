// Pure, unit-testable Match Simulator math. No I/O, no framework imports — every function here
// takes already-fetched rows (real season ratings or none) and returns a deterministic result. Nothing
// is randomized and nothing is fabricated: a team with no synced EPA contributes 0 and is flagged
// via `hasData` / `dataCompleteness` rather than being guessed at.

import type {
  AllianceCapability,
  AllianceColor,
  LeverageLever,
  MatchPhase,
  MatchSimResult,
  TeamCapability,
  TimelinePoint,
} from "./types";

export const MATCH_PHASES: MatchPhase[] = ["auto", "teleop", "endgame"];

/** Standard FRC match landmark seconds used for the cumulative timeline. */
export const AUTO_END_SECONDS = 15;
export const TELEOP_END_SECONDS = 135;
export const MATCH_END_SECONDS = 150;

export function phaseLabel(phase: MatchPhase): string {
  if (phase === "auto") return "Autonomous";
  if (phase === "teleop") return "Teleop";
  return "Endgame";
}

export function computeAllianceCapability(color: AllianceColor, teams: TeamCapability[]): AllianceCapability {
  const auto = teams.reduce((sum, t) => sum + (t.epaAuto ?? 0), 0);
  const teleop = teams.reduce((sum, t) => sum + (t.epaTeleop ?? 0), 0);
  const endgame = teams.reduce((sum, t) => sum + (t.epaEndgame ?? 0), 0);
  const withData = teams.filter((t) => t.hasData).length;
  return {
    color,
    teams,
    auto: round1(auto),
    teleop: round1(teleop),
    endgame: round1(endgame),
    total: round1(auto + teleop + endgame),
    dataCompleteness: teams.length > 0 ? withData / teams.length : 0,
  };
}

export function buildTimeline(red: AllianceCapability, blue: AllianceCapability): TimelinePoint[] {
  return [
    { tSeconds: 0, label: "Match start", phase: "auto", redScore: 0, blueScore: 0 },
    {
      tSeconds: AUTO_END_SECONDS,
      label: "End of auto",
      phase: "auto",
      redScore: red.auto,
      blueScore: blue.auto,
    },
    {
      tSeconds: TELEOP_END_SECONDS,
      label: "End of teleop scoring",
      phase: "teleop",
      redScore: round1(red.auto + red.teleop),
      blueScore: round1(blue.auto + blue.teleop),
    },
    {
      tSeconds: MATCH_END_SECONDS,
      label: "Final",
      phase: "endgame",
      redScore: red.total,
      blueScore: blue.total,
    },
  ];
}

/**
 * The single highest-leverage lever: the match phase with the largest gap between alliances,
 * scoped to the specific team on the trailing alliance contributing least in that phase (from
 * real data only — teams with no synced phase EPA are skipped as candidates).
 */
export function computeLever(red: AllianceCapability, blue: AllianceCapability): LeverageLever | null {
  let best: { phase: MatchPhase; alliance: AllianceColor; gap: number } | null = null;
  for (const phase of MATCH_PHASES) {
    const redPhase = phaseValue(red, phase);
    const bluePhase = phaseValue(blue, phase);
    const gap = Math.abs(redPhase - bluePhase);
    if (gap <= 0) continue;
    if (!best || gap > best.gap) {
      best = { phase, alliance: redPhase < bluePhase ? "red" : "blue", gap };
    }
  }
  if (!best) return null;

  const trailing = best.alliance === "red" ? red : blue;
  const candidates = trailing.teams.filter((t) => phaseTeamValue(t, best!.phase) !== null);
  let weakest: TeamCapability | null = null;
  for (const team of candidates) {
    const value = phaseTeamValue(team, best.phase) ?? 0;
    if (!weakest || value < (phaseTeamValue(weakest, best.phase) ?? 0)) weakest = team;
  }

  return {
    alliance: best.alliance,
    phase: best.phase,
    teamKey: weakest?.teamKey ?? null,
    teamNumber: weakest?.teamNumber ?? null,
    phaseGap: round1(best.gap),
    marginSwing: round1(best.gap),
    rationale: weakest
      ? `${trailing.color === "red" ? "Red" : "Blue"} trails by ${round1(best.gap)} pts in ${phaseLabel(best.phase)}; team ${weakest.teamNumber ?? weakest.teamKey} contributes the least there on real season ratings.`
      : `${trailing.color === "red" ? "Red" : "Blue"} trails by ${round1(best.gap)} pts in ${phaseLabel(best.phase)}, but no team on that alliance has synced ${phaseLabel(best.phase)} season ratings to attribute it to.`,
  };
}

export function computeMatchSimResult(red: AllianceCapability, blue: AllianceCapability): MatchSimResult {
  const timeline = buildTimeline(red, blue);
  const finalMargin = round1(red.total - blue.total);
  const favored: AllianceColor | "even" = finalMargin > 0.5 ? "red" : finalMargin < -0.5 ? "blue" : "even";
  return {
    red,
    blue,
    timeline,
    finalMargin,
    favored,
    lever: computeLever(red, blue),
    computedAt: new Date().toISOString(),
  };
}

function phaseValue(alliance: AllianceCapability, phase: MatchPhase): number {
  if (phase === "auto") return alliance.auto;
  if (phase === "teleop") return alliance.teleop;
  return alliance.endgame;
}

function phaseTeamValue(team: TeamCapability, phase: MatchPhase): number | null {
  if (phase === "auto") return team.epaAuto;
  if (phase === "teleop") return team.epaTeleop;
  return team.epaEndgame;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
