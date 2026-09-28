/**
 * Team ratings built from a team's own scouting.
 *
 * Until now scouting could only nudge a prediction that official numbers had
 * already produced: `teamContribution` returned null unless Statbotics EPA or
 * an OPR family stat existed, and the web layer never even filled the scouting
 * fields in. So every hour a team spent on tablets moved nothing, and at an
 * event with no official data — an off-season like GRITS, a week-0 scrimmage,
 * the first morning of week 1 — every match was skipped with "no rating yet".
 *
 * That is backwards. At exactly the events where public data does not exist,
 * the team's own scouting is the only data there is, and it is good data:
 * somebody watched that robot and wrote down what it did.
 *
 * This module turns scouted match rows into a per-team contribution the
 * predictor can use on its own or alongside official numbers.
 *
 * What it will not do is decide what a game action is worth. The points on
 * each row come from the org's own value formula (`org_value_formulas`,
 * evaluated by `evaluateFormula`), because the number of points a fuel cell
 * scores is in the manual and in the team's formula, not in this file. A pack
 * whose manual is not out yet has no weights to guess at, and guessing is how
 * you get a confident wrong answer.
 */

import { shrinkRatings, type TeamSample } from "./shrinkage";
import { summariseDistribution } from "./distribution";
import { matchSdFromDistribution } from "./score-uncertainty";

/**
 * One robot, one match, as this team's scouts recorded it.
 *
 * Phase points are already-converted numbers, not raw counts: the caller runs
 * the org's formula over the payload first. A phase left null means "not
 * recorded", which is different from zero and is treated differently below.
 */
export type ScoutedMatchRow = {
  teamKey: string;
  matchKey: string;
  /** Whole-match points; null means the total was not observed or cannot be computed. */
  total?: number | null;
  auto?: number | null;
  teleop?: number | null;
  endgame?: number | null;
  /** Recorded as disabled, no-show, or dead on the field. */
  disabled?: boolean;
  /** Recorded as playing defense rather than scoring. */
  defense?: boolean;
  /** Recorded as completing the season's endgame climb. */
  climbed?: boolean;
  /** Retained disagreement evidence after combining reports for a robot and match. */
  reportCount?: number;
  totalRange?: [number, number] | null;
};

export type ScoutingConfidence = "low" | "medium" | "high";

export type ScoutedTeamRating = {
  teamKey: string;
  /** Matches that carried at least one recorded phase. */
  matches: number;
  meanAuto: number;
  meanTeleop: number;
  meanEndgame: number;
  /** Each phase uses only matches that actually recorded that phase. */
  phaseSamples?: { auto: number; teleop: number; endgame: number };
  /** Mean total per match, before shrinkage. */
  meanTotal: number;
  /** Mean total pulled toward the field, by how thin the evidence is. */
  shrunkTotal: number;
  /** Share of scouted matches where the robot climbed, or null if never recorded. */
  climbRate: number | null;
  /** Share of scouted matches where the robot was disabled. */
  disabledRate: number;
  /** Share of scouted matches where the robot was playing defense. */
  defenseRate: number;
  /**
   * This robot's match-to-match spread in points, or null when the sample is
   * too thin to have one.
   *
   * Carried on the rating because the score predictor needs it and had no way
   * to get it: `TeamScoreFeatures.matchSd` existed and nothing filled it, so
   * every alliance band was computed from the *assumed* 30% dispersion rather
   * than from how much the robot actually swings. A metronome and a
   * boom-or-bust robot produced the same confidence.
   *
   * Same measure the pick list calls "streaky" — IQR over the median, via
   * `summariseDistribution` — so a screen explaining a wide band and a screen
   * labelling the robot cannot disagree.
   */
  matchSd: number | null;
  confidence: ScoutingConfidence;
  /** One line a student can read, naming the sample this rests on. */
  sampleNote: string;
};

/**
 * Below this many matches a scouting rating is not allowed to stand in for a
 * missing official rating.
 *
 * Two matches is where the loudest wrong numbers come from — the same reason
 * `shrinkage.ts` exists. Shrinkage already pulls a thin estimate toward the
 * field, but shrinkage cannot rescue a rating that is the *only* thing holding
 * up a prediction: with nothing official to blend against, a two-match mean
 * would set the number by itself. Three is the smallest sample where a robot
 * has been seen in more than one alliance pairing.
 */
export const MIN_MATCHES_TO_STAND_ALONE = 3;

/** At or above this, the sample is worth as much as an early-event EPA. */
export const CONFIDENT_MATCHES = 8;

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const centre = mean(values);
  return values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1);
}

function confidenceFor(matches: number): ScoutingConfidence {
  if (matches >= CONFIDENT_MATCHES) return "high";
  if (matches >= MIN_MATCHES_TO_STAND_ALONE) return "medium";
  return "low";
}

function sampleNoteFor(matches: number, disabled: number): string {
  const plural = matches === 1 ? "match" : "matches";
  const base = `From your scouting: ${matches} ${plural}`;
  if (disabled === 0) return `${base}.`;
  const deadClause = disabled === 1 ? "a reported breakdown in one" : `reported breakdowns in ${disabled}`;
  return `${base}, ${deadClause} — that is in the average.`;
}

/**
 * Is there anything on this row?
 *
 * A form opened and saved with nothing filled in must not read as a robot that
 * scored zero. A robot recorded as disabled *is* a real zero and counts: that
 * it breaks is one of the most useful things scouting knows about it.
 */
function rowHasSignal(row: ScoutedMatchRow): boolean {
  return scoutedMatchTotal(row) != null;
}

export function scoutedMatchTotal(row: ScoutedMatchRow): number | null {
  if (row.total !== undefined) return finite(row.total) ? row.total : null;
  const parts = [row.auto, row.teleop, row.endgame].filter(finite);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) : null;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Combine reports before computing event averages; retain their score range. */
export function combineScoutedMatchRows(rows: readonly ScoutedMatchRow[]): ScoutedMatchRow[] {
  const groups = new Map<string, ScoutedMatchRow[]>();
  for (const row of rows) {
    if (!row.teamKey) continue;
    const key = row.matchKey ? `${row.teamKey}|${row.matchKey}` : `${row.teamKey}|unknown:${groups.size}`;
    const list = groups.get(key) ?? [];
    list.push(row); groups.set(key, list);
  }
  const observedMean = (values: (number | null | undefined)[]) => {
    const observed = values.filter(finite);
    return observed.length ? mean(observed) : null;
  };
  return [...groups.values()].map(list => {
    const first = list[0]!;
    if (list.length === 1) return { ...first };
    const totals = list.map(scoutedMatchTotal).filter(finite);
    const climbs = list.map(row => row.climbed).filter(value => typeof value === "boolean");
    return {
      teamKey: first.teamKey, matchKey: first.matchKey,
      total: observedMean(totals),
      auto: observedMean(list.map(row => row.auto)),
      teleop: observedMean(list.map(row => row.teleop)),
      endgame: observedMean(list.map(row => row.endgame)),
      disabled: list.filter(row => row.disabled).length * 2 >= list.length,
      defense: list.some(row => row.defense),
      ...(climbs.length ? { climbed: climbs.some(Boolean) } : {}),
      reportCount: list.reduce((sum, row) => sum + (row.reportCount ?? 1), 0),
      totalRange: totals.length ? [Math.min(...totals), Math.max(...totals)] : null,
    };
  });
}

/** Fewer rows than this and the field median is not a fair yardstick for "impossible". */
export const MIN_ROWS_FOR_PLAUSIBILITY = 12;

function rowTotal(row: ScoutedMatchRow): number {
  return scoutedMatchTotal(row) ?? 0;
}

/**
 * Entries no robot could have scored: more than six times the field's median entry and at least
 * 80 points above it. One typo ("1818" for "18") made a robot "386 a match", topped every pick
 * list and moved the win chance of every match it played. These are left out of every average
 * and returned so a lead can open and fix them. A genuinely elite robot sits at two to three
 * times the median, well inside the line.
 */
export function implausibleScoutRows(rows: readonly ScoutedMatchRow[]): ScoutedMatchRow[] {
  const totals = rows.filter((row) => row.teamKey && rowHasSignal(row) && !row.disabled).map(rowTotal).sort((a, b) => a - b);
  if (totals.length < MIN_ROWS_FOR_PLAUSIBILITY) return [];
  const median = totals[Math.floor(totals.length / 2)]!;
  const limit = Math.max(median * 6, median + 80);
  return rows.filter((row) => row.teamKey && rowHasSignal(row) && rowTotal(row) > limit);
}

/**
 * Per-team ratings from scouted rows, shrunk toward the field.
 *
 * Teams with no usable rows are left out entirely rather than returned as
 * zeroes — a team nobody scouted is unknown, not bad. Implausible entries
 * (implausibleScoutRows) are left out.
 */
export function ratingsFromScouting(rows: readonly ScoutedMatchRow[]): ScoutedTeamRating[] {
  rows = combineScoutedMatchRows(rows);
  const implausible = new Set(implausibleScoutRows(rows));
  const byTeam = new Map<string, ScoutedMatchRow[]>();
  for (const row of rows) {
    if (implausible.has(row)) continue;
    if (!row.teamKey || !rowHasSignal(row)) continue;
    const list = byTeam.get(row.teamKey);
    if (list) list.push(row);
    else byTeam.set(row.teamKey, [row]);
  }
  if (byTeam.size === 0) return [];

  // One row per team per match. A match scouted twice (two scouts on the same
  // robot, or a re-sync of the same tablet) must not double its weight.
  const deduped = new Map<string, ScoutedMatchRow[]>();
  for (const [teamKey, list] of byTeam) {
    const seen = new Map<string, ScoutedMatchRow>();
    for (const row of list) {
      const key = row.matchKey || `${teamKey}:${seen.size}`;
      if (!seen.has(key)) seen.set(key, row);
    }
    deduped.set(teamKey, [...seen.values()]);
  }

  const samples: TeamSample[] = [];
  const stats = new Map<
    string,
    { autos: number[]; teleops: number[]; endgames: number[]; totals: number[]; climbs: number; climbRecorded: number; disabled: number; defense: number }
  >();

  for (const [teamKey, list] of deduped) {
    const autos: number[] = [];
    const teleops: number[] = [];
    const endgames: number[] = [];
    const totals: number[] = [];
    let climbs = 0;
    let climbRecorded = 0;
    let disabled = 0;
    let defense = 0;

    for (const row of list) {
      if (finite(row.auto)) autos.push(row.auto);
      if (finite(row.teleop)) teleops.push(row.teleop);
      if (finite(row.endgame)) endgames.push(row.endgame);
      totals.push(scoutedMatchTotal(row)!);
      if (row.climbed != null) {
        climbRecorded += 1;
        if (row.climbed) climbs += 1;
      }
      if (row.disabled) disabled += 1;
      if (row.defense) defense += 1;
    }

    stats.set(teamKey, { autos, teleops, endgames, totals, climbs, climbRecorded, disabled, defense });
    samples.push({
      teamKey,
      rating: mean(totals),
      matches: totals.length,
      variance: variance(totals),
    });
  }

  const shrunk = new Map(shrinkRatings(samples).map((row) => [row.teamKey, row]));

  const out: ScoutedTeamRating[] = [];
  for (const [teamKey, stat] of stats) {
    const matches = stat.totals.length;
    out.push({
      teamKey,
      matches,
      meanAuto: mean(stat.autos),
      meanTeleop: mean(stat.teleops),
      meanEndgame: mean(stat.endgames),
      phaseSamples: { auto: stat.autos.length, teleop: stat.teleops.length, endgame: stat.endgames.length },
      meanTotal: mean(stat.totals),
      shrunkTotal: shrunk.get(teamKey)?.shrunk ?? mean(stat.totals),
      climbRate: stat.climbRecorded > 0 ? stat.climbs / stat.climbRecorded : null,
      disabledRate: matches > 0 ? stat.disabled / matches : 0,
      defenseRate: matches > 0 ? stat.defense / matches : 0,
      matchSd: matchSdFromDistribution(summariseDistribution(stat.totals)),
      confidence: confidenceFor(matches),
      sampleNote: sampleNoteFor(matches, stat.disabled),
    });
  }
  out.sort((a, b) => b.shrunkTotal - a.shrunkTotal || a.teamKey.localeCompare(b.teamKey));
  return out;
}

/** Can this rating carry a prediction on its own, with no official numbers? */
export function canStandAlone(rating: ScoutedTeamRating | null | undefined): boolean {
  return rating != null && rating.matches >= MIN_MATCHES_TO_STAND_ALONE;
}

export function ratingsByTeam(
  ratings: readonly ScoutedTeamRating[],
): Map<string, ScoutedTeamRating> {
  return new Map(ratings.map((rating) => [rating.teamKey, rating]));
}
