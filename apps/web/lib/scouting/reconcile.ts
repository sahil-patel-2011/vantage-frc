/**
 * Scouted-vs-TBA reconciliation.
 *
 * Sums what our scouts recorded for each robot on an alliance and checks the
 * alliance sum against the official total TBA published in the cached
 * `matches_ref.score_breakdown`. A large gap means the form, the scouts, or our
 * reading of the game manual is off — strategy night wants that surfaced, not
 * smoothed over.
 *
 * Pure: no I/O, no framework imports, no AI. Honesty rules:
 *  - a robot nobody scouted has a null estimate and is never treated as zero;
 *  - an alliance we only partially scouted is flagged "partial", never compared
 *    to the official total as if it were complete;
 *  - a match with no cached score breakdown is "no_official", never assumed;
 *  - distribute-by-share refuses to split when there is no scouted signal to
 *    split by, and says why.
 */

import { inferRoleForFieldKey, type ScoutFieldRoleMap } from "@vantage/prediction-strategy";

/** Alliance-total gap at or above this fraction gets a review flag. */
export const REVIEW_DELTA_PCT = 0.15;

/** Roles whose numeric answers are points a robot put on the board. */
const SCORING_ROLES = new Set(["auto_score", "teleop_score", "endgame"]);

/** Keys a scout payload (or a TBA alliance breakdown) may use for the total. */
const TOTAL_POINTS_ALIASES = ["totalPoints", "total_points", "totalScore", "points"] as const;

/**
 * Foul points are awarded to an alliance for the OTHER alliance's penalties, so
 * they are in `totalPoints` but were never put on the board by the three robots
 * our scouts watched. Subtracting them is what makes the comparison honest.
 */
const FOUL_POINTS_ALIASES = ["foulPoints", "foul_points"] as const;

export type ReconcileSide = "red" | "blue";

export type ReconcileEntry = {
  entryId: string;
  matchKey: string;
  teamKey: string;
  scoutUserId?: string | null;
  scoutName?: string | null;
  payload: Record<string, unknown> | null | undefined;
};

export type ReconcileMatchRow = {
  matchKey: string;
  matchNumber: number;
  compLevel: string;
  redAlliance: unknown;
  blueAlliance: unknown;
  scoreBreakdown?: Record<string, unknown> | null;
};

/** How one robot's scouted point estimate was derived — shown, never hidden. */
export type RobotEstimateBasis = "total" | "roles";

export type ReconcileRobot = {
  teamKey: string;
  /** Median across the scouts who covered this robot; null when nobody did. */
  estimate: number | null;
  basis: RobotEstimateBasis | null;
  /** Payload keys that fed the estimate, so a coach can audit the number. */
  fields: string[];
  scoutCount: number;
  entryIds: string[];
};

export type ReconcileFlag = "ok" | "review" | "partial" | "no_scouting" | "no_official";

export type ReconcileAlliance = {
  side: ReconcileSide;
  teamKeys: string[];
  robots: ReconcileRobot[];
  scoutedRobots: number;
  /** Sum of the scouted robot estimates. Null when no robot was scouted. */
  ourTotal: number | null;
  /** Official alliance total from the cached score breakdown. Null when absent. */
  officialTotal: number | null;
  /** Foul points inside that total, credited for the OTHER alliance's penalties. */
  officialFoulPoints: number | null;
  /**
   * What the robots actually put on the board: officialTotal minus foul points.
   * This — not officialTotal — is what a scouted robot sum is comparable to.
   * Falls back to officialTotal when the game's breakdown carries no foul field.
   */
  officialScoringTotal: number | null;
  delta: number | null;
  /** (ourTotal - officialScoringTotal) / |officialScoringTotal|. Null if either is null. */
  deltaPct: number | null;
  flag: ReconcileFlag;
  message: string;
};

export type ReconciledMatch = {
  matchKey: string;
  matchNumber: number;
  compLevel: string;
  red: ReconcileAlliance;
  blue: ReconcileAlliance;
  flag: ReconcileFlag;
  /** Largest absolute deltaPct across the two alliances we could compare. */
  worstDeltaPct: number | null;
  needsReview: boolean;
};

export type ReconcileSummary = {
  matches: number;
  comparedAlliances: number;
  flaggedMatches: number;
  matchesWithoutBreakdown: number;
  matchesWithoutScouting: number;
  /** Mean |deltaPct| across fully-scouted, fully-official alliances. */
  meanAbsDeltaPct: number | null;
};

export type ReconcileReport = {
  matches: ReconciledMatch[];
  summary: ReconcileSummary;
  reviewDeltaPct: number;
};

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function totalFromRecord(record: Record<string, unknown> | null | undefined): number | null {
  if (!record) return null;
  for (const alias of TOTAL_POINTS_ALIASES) {
    const value = numeric(record[alias]);
    if (value != null) return value;
  }
  return null;
}

/** Alliance jsonb as written by the reference worker, plus TBA's raw shapes. */
export function allianceTeamKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["teamKeys", "team_keys"]) {
    const list = record[key];
    if (Array.isArray(list)) return list.filter((item): item is string => typeof item === "string");
  }
  return [];
}

export function officialAllianceTotal(
  breakdown: Record<string, unknown> | null | undefined,
  side: ReconcileSide,
): number | null {
  if (!breakdown) return null;
  const alliance = breakdown[side];
  if (!alliance || typeof alliance !== "object") return null;
  return totalFromRecord(alliance as Record<string, unknown>);
}

/** Foul points TBA credited to this alliance, or null when the game has none. */
export function officialAllianceFoulPoints(
  breakdown: Record<string, unknown> | null | undefined,
  side: ReconcileSide,
): number | null {
  if (!breakdown) return null;
  const alliance = breakdown[side];
  if (!alliance || typeof alliance !== "object") return null;
  for (const alias of FOUL_POINTS_ALIASES) {
    const value = numeric((alliance as Record<string, unknown>)[alias]);
    if (value != null) return value;
  }
  return null;
}

/**
 * One scout entry's point estimate for one robot.
 * Prefers an explicit total-points answer; otherwise sums the numeric answers
 * whose strategy role scores points (the same role ladder the scout→strategy
 * bridge uses). Returns null when the payload carries no scoring number at all —
 * a form full of checkboxes must not read as "this robot scored 0".
 */
export function robotEstimateFromPayload(
  payload: Record<string, unknown> | null | undefined,
  roles?: ScoutFieldRoleMap,
): { points: number; basis: RobotEstimateBasis; fields: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  for (const alias of TOTAL_POINTS_ALIASES) {
    const value = numeric(payload[alias]);
    if (value != null) return { points: value, basis: "total", fields: [alias] };
  }
  let points = 0;
  const fields: string[] = [];
  for (const key of Object.keys(payload)) {
    const role = roles?.[key] ?? inferRoleForFieldKey(key);
    if (!SCORING_ROLES.has(role)) continue;
    const value = numeric(payload[key]);
    if (value == null) continue;
    points += value;
    fields.push(key);
  }
  if (!fields.length) return null;
  return { points, basis: "roles", fields };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

const teamLabel = (teamKey: string) => teamKey.replace(/^frc/i, "") || teamKey;

/**
 * Combines every scout entry for one robot into a single estimate. Multiple
 * scouts on one robot are reconciled by median, so one bad sheet cannot drag the
 * alliance total on its own.
 */
export function robotEstimate(
  teamKey: string,
  entries: ReconcileEntry[],
  roles?: ScoutFieldRoleMap,
): ReconcileRobot {
  const points: number[] = [];
  const fields = new Set<string>();
  const entryIds: string[] = [];
  let basis: RobotEstimateBasis | null = null;
  for (const entry of entries) {
    entryIds.push(entry.entryId);
    const estimate = robotEstimateFromPayload(entry.payload, roles);
    if (!estimate) continue;
    points.push(estimate.points);
    for (const field of estimate.fields) fields.add(field);
    // "total" is the stronger basis; report it whenever any scout supplied one.
    if (basis !== "total") basis = estimate.basis;
  }
  return {
    teamKey,
    estimate: points.length ? median(points) : null,
    basis: points.length ? basis : null,
    fields: [...fields].sort(),
    scoutCount: points.length,
    entryIds,
  };
}

function reconcileAlliance(
  side: ReconcileSide,
  teamKeys: string[],
  entriesByTeam: Map<string, ReconcileEntry[]>,
  officialTotal: number | null,
  officialFoulPoints: number | null,
  roles?: ScoutFieldRoleMap,
): ReconcileAlliance {
  const robots = teamKeys.map((teamKey) =>
    robotEstimate(teamKey, entriesByTeam.get(teamKey) ?? [], roles),
  );
  const scouted = robots.filter((robot) => robot.estimate != null);
  const ourTotal = scouted.length
    ? scouted.reduce((sum, robot) => sum + (robot.estimate ?? 0), 0)
    : null;

  // Scouts count what the robots scored, so the comparable official figure
  // excludes foul points the opponent handed this alliance.
  const officialScoringTotal =
    officialTotal == null ? null : officialTotal - (officialFoulPoints ?? 0);

  const delta =
    ourTotal != null && officialScoringTotal != null ? ourTotal - officialScoringTotal : null;
  const deltaPct =
    delta == null || officialScoringTotal == null
      ? null
      : officialScoringTotal === 0
        ? delta === 0
          ? 0
          : null
        : delta / Math.abs(officialScoringTotal);

  const foulNote =
    officialFoulPoints ? ` (${officialTotal} official less ${officialFoulPoints} foul)` : "";

  let flag: ReconcileFlag;
  let message: string;
  if (officialTotal == null) {
    flag = "no_official";
    message = "TBA has published no score breakdown for this alliance yet.";
  } else if (!scouted.length) {
    flag = "no_scouting";
    message = "No scout entry on this alliance carries a scoring number.";
  } else if (scouted.length < teamKeys.length) {
    flag = "partial";
    const missing = robots
      .filter((robot) => robot.estimate == null)
      .map((robot) => teamLabel(robot.teamKey))
      .join(", ");
    message = `Only ${scouted.length} of ${teamKeys.length} robots scouted (missing ${missing}) — a partial sum is not comparable to the official total.`;
  } else if (deltaPct == null) {
    flag = "partial";
    message = "The official robot-scored total is zero, so a percentage gap cannot be computed.";
  } else if (Math.abs(deltaPct) >= REVIEW_DELTA_PCT) {
    flag = "review";
    message = `Scouted ${ourTotal} vs official ${officialScoringTotal}${foulNote} — ${(
      deltaPct * 100
    ).toFixed(0)}% ${delta! > 0 ? "over" : "under"}.`;
  } else {
    flag = "ok";
    message = `Scouted ${ourTotal} vs official ${officialScoringTotal}${foulNote} — within ${Math.round(
      REVIEW_DELTA_PCT * 100,
    )}%.`;
  }

  return {
    side,
    teamKeys,
    robots,
    scoutedRobots: scouted.length,
    ourTotal,
    officialTotal,
    officialFoulPoints,
    officialScoringTotal,
    delta,
    deltaPct,
    flag,
    message,
  };
}

const FLAG_SEVERITY: Record<ReconcileFlag, number> = {
  review: 4,
  partial: 3,
  no_scouting: 2,
  no_official: 1,
  ok: 0,
};

function worstFlag(a: ReconcileFlag, b: ReconcileFlag): ReconcileFlag {
  return FLAG_SEVERITY[a] >= FLAG_SEVERITY[b] ? a : b;
}

/** Reconciles one match: both alliances, scouted sum vs official total. */
export function reconcileMatch(
  match: ReconcileMatchRow,
  entries: ReconcileEntry[],
  roles?: ScoutFieldRoleMap,
): ReconciledMatch {
  const entriesByTeam = new Map<string, ReconcileEntry[]>();
  for (const entry of entries) {
    if (!entry || entry.matchKey !== match.matchKey) continue;
    const list = entriesByTeam.get(entry.teamKey);
    if (list) list.push(entry);
    else entriesByTeam.set(entry.teamKey, [entry]);
  }
  const red = reconcileAlliance(
    "red",
    allianceTeamKeys(match.redAlliance),
    entriesByTeam,
    officialAllianceTotal(match.scoreBreakdown, "red"),
    officialAllianceFoulPoints(match.scoreBreakdown, "red"),
    roles,
  );
  const blue = reconcileAlliance(
    "blue",
    allianceTeamKeys(match.blueAlliance),
    entriesByTeam,
    officialAllianceTotal(match.scoreBreakdown, "blue"),
    officialAllianceFoulPoints(match.scoreBreakdown, "blue"),
    roles,
  );
  const comparable = [red, blue].filter(
    (alliance) => alliance.deltaPct != null && alliance.flag !== "partial",
  );
  const worstDeltaPct = comparable.length
    ? comparable.reduce(
        (worst, alliance) =>
          Math.abs(alliance.deltaPct!) > Math.abs(worst) ? alliance.deltaPct! : worst,
        comparable[0]!.deltaPct!,
      )
    : null;
  const flag = worstFlag(red.flag, blue.flag);
  return {
    matchKey: match.matchKey,
    matchNumber: Number(match.matchNumber) || 0,
    compLevel: typeof match.compLevel === "string" ? match.compLevel : "qm",
    red,
    blue,
    flag,
    worstDeltaPct,
    needsReview: red.flag === "review" || blue.flag === "review",
  };
}

/**
 * Reconciles every supplied match. Matches sort worst-gap first so a strategy
 * lead opens the page on the sheets that actually need re-watching.
 */
export function reconcileEvent(input: {
  matches: ReconcileMatchRow[];
  entries: ReconcileEntry[];
  roles?: ScoutFieldRoleMap;
}): ReconcileReport {
  const entriesByMatch = new Map<string, ReconcileEntry[]>();
  for (const entry of input.entries) {
    if (!entry || typeof entry.matchKey !== "string" || !entry.matchKey) continue;
    const list = entriesByMatch.get(entry.matchKey);
    if (list) list.push(entry);
    else entriesByMatch.set(entry.matchKey, [entry]);
  }

  const matches = input.matches
    .filter((match) => match && typeof match.matchKey === "string" && match.matchKey)
    .map((match) => reconcileMatch(match, entriesByMatch.get(match.matchKey) ?? [], input.roles));

  const comparable: number[] = [];
  let comparedAlliances = 0;
  let matchesWithoutBreakdown = 0;
  let matchesWithoutScouting = 0;
  for (const match of matches) {
    for (const alliance of [match.red, match.blue]) {
      if (alliance.flag === "ok" || alliance.flag === "review") {
        comparedAlliances += 1;
        if (alliance.deltaPct != null) comparable.push(Math.abs(alliance.deltaPct));
      }
    }
    if (match.red.flag === "no_official" && match.blue.flag === "no_official") {
      matchesWithoutBreakdown += 1;
    } else if (match.red.flag === "no_scouting" && match.blue.flag === "no_scouting") {
      matchesWithoutScouting += 1;
    }
  }

  matches.sort((a, b) => {
    const aReview = a.needsReview ? 1 : 0;
    const bReview = b.needsReview ? 1 : 0;
    if (aReview !== bReview) return bReview - aReview;
    const aDelta = Math.abs(a.worstDeltaPct ?? 0);
    const bDelta = Math.abs(b.worstDeltaPct ?? 0);
    if (aDelta !== bDelta) return bDelta - aDelta;
    return a.matchNumber - b.matchNumber || (a.matchKey < b.matchKey ? -1 : 1);
  });

  return {
    matches,
    summary: {
      matches: matches.length,
      comparedAlliances,
      flaggedMatches: matches.filter((match) => match.needsReview).length,
      matchesWithoutBreakdown,
      matchesWithoutScouting,
      meanAbsDeltaPct: comparable.length
        ? comparable.reduce((sum, value) => sum + value, 0) / comparable.length
        : null,
    },
    reviewDeltaPct: REVIEW_DELTA_PCT,
  };
}

export type DistributedShare = {
  teamKey: string;
  estimate: number;
  /** Fraction of the scouted alliance estimate this robot accounted for. */
  share: number;
  /** That fraction of the official alliance total. */
  points: number;
};

export type DistributeByShareResult =
  | { status: "distributed"; officialTotal: number; robots: DistributedShare[] }
  | { status: "unavailable"; reason: string };

/**
 * Splits the official alliance total across the three robots in proportion to
 * what our scouts estimated each one scored — the mechanic teams described for
 * turning an alliance-level official score into per-robot credit.
 *
 * Refuses (with a reason) rather than inventing a split when a robot is
 * unscouted, when the scouted estimates sum to zero, or when any estimate is
 * negative — none of those can be divided by share honestly.
 */
export function distributeByShare(
  officialTotal: number | null,
  robots: Array<{ teamKey: string; estimate: number | null }>,
): DistributeByShareResult {
  if (officialTotal == null || !Number.isFinite(officialTotal)) {
    return { status: "unavailable", reason: "No official alliance total is cached for this match." };
  }
  if (!robots.length) {
    return { status: "unavailable", reason: "No robots on this alliance to distribute across." };
  }
  const missing = robots.filter((robot) => robot.estimate == null);
  if (missing.length) {
    return {
      status: "unavailable",
      reason: `Distribute-by-share needs every robot scouted — ${missing
        .map((robot) => teamLabel(robot.teamKey))
        .join(", ")} ${missing.length === 1 ? "has" : "have"} no scouted number.`,
    };
  }
  if (robots.some((robot) => (robot.estimate ?? 0) < 0)) {
    return { status: "unavailable", reason: "A scouted estimate is negative, so shares are undefined." };
  }
  const sum = robots.reduce((total, robot) => total + (robot.estimate ?? 0), 0);
  if (sum <= 0) {
    return {
      status: "unavailable",
      reason: "Every scouted estimate on this alliance is zero — there is no share to divide by.",
    };
  }
  return {
    status: "distributed",
    officialTotal,
    robots: robots.map((robot) => {
      const estimate = robot.estimate ?? 0;
      const share = estimate / sum;
      return { teamKey: robot.teamKey, estimate, share, points: share * officialTotal };
    }),
  };
}
