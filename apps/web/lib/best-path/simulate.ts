/**
 * Best Path seed planner — pure simulation.
 *
 * `seedProjection` re-seeds an event from cached standings + the remaining
 * qualification schedule under a set of forced outcomes. `bestPath` searches for
 * the SMALLEST set of forced outcomes that reaches the best seed it can reach,
 * with a deterministic cap the caller must surface.
 *
 * Deliberate honesty rules:
 *  - a team with no standings row is reported in `unknownTeams`, never seeded at 0;
 *  - a match with no prediction contributes nothing and is counted as undecided;
 *  - ranking-point values come from a season table that flags itself unconfirmed
 *    for seasons we have not encoded;
 *  - projected ties are broken by the CURRENT official rank (which already encodes
 *    this season's real sort orders). We do not model sort-order tiebreakers.
 */

import type {
  AllianceOutcome,
  AllianceSide,
  BestPathFlip,
  BestPathLimits,
  BestPathResult,
  OutcomeOverrides,
  ProjectedRow,
  RankingPointRules,
  RemainingMatch,
  SeedProjection,
  StandingTeam,
} from "./types";

export type {
  AllianceOutcome,
  AllianceSide,
  BestPathFlip,
  BestPathLimits,
  BestPathResult,
  OutcomeOverrides,
  ProjectedRow,
  RankingPointRules,
  RemainingMatch,
  SeedProjection,
  StandingTeam,
};

/** Win RP moved from 2 to 3 in 2025 (Reefscape). Ties have paid 1 RP throughout. */
const WIN_RP_BY_ERA = [
  { from: 2025, win: 3, tie: 1, loss: 0, label: "win 3 RP / tie 1 RP" },
  { from: 2016, win: 2, tie: 1, loss: 0, label: "win 2 RP / tie 1 RP" },
] as const;

export function rankingPointRulesForYear(year: number | null | undefined): RankingPointRules {
  const latest = WIN_RP_BY_ERA[0];
  if (year == null || !Number.isFinite(year)) {
    return {
      win: latest.win,
      tie: latest.tie,
      loss: latest.loss,
      year: null,
      label: latest.label + " (season unknown - confirm this year's game manual)",
      confirmed: false,
    };
  }
  const oldest = WIN_RP_BY_ERA[WIN_RP_BY_ERA.length - 1] ?? latest;
  const era = WIN_RP_BY_ERA.find((entry) => year >= entry.from) ?? oldest;
  // Only win/tie RP through 2025 is encoded here; a later season may change it.
  const confirmed = year <= 2025 && year >= 2016;
  return {
    win: era.win,
    tie: era.tie,
    loss: era.loss,
    year,
    label: confirmed
      ? year + " · " + era.label
      : year + " · assumes " + era.label + " - confirm this season's game manual",
    confirmed,
  };
}

export const DEFAULT_RANKING_POINT_RULES = rankingPointRulesForYear(null);

export const DEFAULT_BEST_PATH_LIMITS: BestPathLimits = {
  maxCandidates: 14,
  maxDepth: 4,
  maxEvaluations: 20000,
  rankWindow: 6,
};

function rpFor(rules: RankingPointRules, outcome: AllianceOutcome, side: AllianceSide): number {
  if (outcome === "tie") return rules.tie;
  return outcome === side ? rules.win : rules.loss;
}

/**
 * Ranking points a team has already banked, from real data only.
 * Prefers the official per-alliance ranking points carried in a cached score
 * breakdown (which already include this season's bonus RPs); falls back to the
 * win/tie record. Returns null when neither is available — never guesses.
 */
export function bankedRankingPoints(input: {
  officialRankingPoints?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  rules: RankingPointRules;
}): { rankingPoints: number; source: "official" | "record"; played: number } | null {
  const wins = Number.isFinite(input.wins) ? Number(input.wins) : null;
  const losses = Number.isFinite(input.losses) ? Number(input.losses) : null;
  const ties = Number.isFinite(input.ties) ? Number(input.ties) : null;
  const played = (wins ?? 0) + (losses ?? 0) + (ties ?? 0);
  if (input.officialRankingPoints != null && Number.isFinite(input.officialRankingPoints)) {
    return { rankingPoints: Number(input.officialRankingPoints), source: "official", played };
  }
  if (wins == null && ties == null) return null;
  return {
    rankingPoints: (wins ?? 0) * input.rules.win + (ties ?? 0) * input.rules.tie,
    source: "record",
    played,
  };
}

type Comparable = { rankingPoints: number; currentRank: number | null; teamKey: string };

/** The single ordering used by both the full projection and the fast rank probe. */
function compareProjected(a: Comparable, b: Comparable): number {
  if (b.rankingPoints !== a.rankingPoints) return b.rankingPoints - a.rankingPoints;
  const aRank = a.currentRank ?? Number.POSITIVE_INFINITY;
  const bRank = b.currentRank ?? Number.POSITIVE_INFINITY;
  if (aRank !== bRank) return aRank - bRank;
  return a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0;
}

export function outcomeFor(
  match: RemainingMatch,
  overrides: OutcomeOverrides | undefined,
): AllianceOutcome | null {
  const forced = overrides?.[match.matchKey];
  return forced ?? match.predicted ?? null;
}

export function seedProjection(
  standings: StandingTeam[],
  remainingMatches: RemainingMatch[],
  overrides: OutcomeOverrides = {},
  rules: RankingPointRules = DEFAULT_RANKING_POINT_RULES,
): SeedProjection {
  const working = new Map<
    string,
    { base: StandingTeam; gained: number; extraPlayed: number; undecided: number }
  >();
  for (const team of standings) {
    if (!team || typeof team.teamKey !== "string" || !team.teamKey) continue;
    if (working.has(team.teamKey)) continue;
    working.set(team.teamKey, { base: team, gained: 0, extraPlayed: 0, undecided: 0 });
  }

  const unknown = new Set<string>();
  let decidedMatches = 0;
  let undecidedMatches = 0;

  for (const match of remainingMatches) {
    if (!match) continue;
    const outcome = outcomeFor(match, overrides);
    if (outcome == null) undecidedMatches += 1;
    else decidedMatches += 1;
    const sides: Array<[AllianceSide, string[]]> = [
      ["red", match.red ?? []],
      ["blue", match.blue ?? []],
    ];
    for (const [side, teams] of sides) {
      for (const teamKey of teams) {
        const entry = working.get(teamKey);
        if (!entry) {
          if (typeof teamKey === "string" && teamKey) unknown.add(teamKey);
          continue;
        }
        if (outcome == null) {
          entry.undecided += 1;
          continue;
        }
        entry.gained += rpFor(rules, outcome, side);
        entry.extraPlayed += 1;
      }
    }
  }

  const scored = [...working.values()].map((entry) => ({
    entry,
    rankingPoints: entry.base.rankingPoints + entry.gained,
    currentRank: entry.base.currentRank ?? null,
    teamKey: entry.base.teamKey,
  }));
  scored.sort(compareProjected);

  const rows: ProjectedRow[] = scored.map((item, index) => ({
    teamKey: item.teamKey,
    rankingPoints: item.entry.base.rankingPoints,
    projectedRankingPoints: item.rankingPoints,
    gained: item.entry.gained,
    played: item.entry.base.played,
    projectedPlayed: item.entry.base.played + item.entry.extraPlayed,
    projectedRank: index + 1,
    currentRank: item.currentRank,
    rankDelta: item.currentRank == null ? null : item.currentRank - (index + 1),
    undecidedMatches: item.entry.undecided,
  }));

  const byTeam: Record<string, ProjectedRow> = {};
  for (const row of rows) byTeam[row.teamKey] = row;

  return {
    rows,
    byTeam,
    rules,
    decidedMatches,
    undecidedMatches,
    unknownTeams: [...unknown].sort(),
  };
}

export function projectedRankOf(projection: SeedProjection, teamKey: string): number | null {
  return projection.byTeam[teamKey]?.projectedRank ?? null;
}

function sideOf(match: RemainingMatch, teamKey: string): AllianceSide | null {
  if ((match.red ?? []).includes(teamKey)) return "red";
  if ((match.blue ?? []).includes(teamKey)) return "blue";
  return null;
}

/**
 * Rank our team would hold if `flips` were applied on top of `baseline`.
 * Exact: only flipped matches differ from the baseline projection, so we adjust
 * ranking-point deltas and re-count who is ahead using the same comparator.
 */
function rankAfterFlips(
  baseline: SeedProjection,
  baselineOverrides: OutcomeOverrides,
  ourKey: string,
  flips: BestPathFlip[],
  matchByKey: Map<string, RemainingMatch>,
  rules: RankingPointRules,
): number | null {
  const ours = baseline.byTeam[ourKey];
  if (!ours) return null;
  const deltas = new Map<string, number>();
  for (const flip of flips) {
    const match = matchByKey.get(flip.matchKey);
    if (!match) continue;
    const before = outcomeFor(match, baselineOverrides);
    const sides: Array<[AllianceSide, string[]]> = [
      ["red", match.red ?? []],
      ["blue", match.blue ?? []],
    ];
    for (const [side, teams] of sides) {
      const beforeRp = before == null ? 0 : rpFor(rules, before, side);
      const afterRp = rpFor(rules, flip.outcome, side);
      const change = afterRp - beforeRp;
      if (change === 0) continue;
      for (const teamKey of teams) {
        if (!baseline.byTeam[teamKey]) continue;
        deltas.set(teamKey, (deltas.get(teamKey) ?? 0) + change);
      }
    }
  }
  const us: Comparable = {
    rankingPoints: ours.projectedRankingPoints + (deltas.get(ourKey) ?? 0),
    currentRank: ours.currentRank,
    teamKey: ourKey,
  };
  let ahead = 0;
  for (const row of baseline.rows) {
    if (row.teamKey === ourKey) continue;
    const other: Comparable = {
      rankingPoints: row.projectedRankingPoints + (deltas.get(row.teamKey) ?? 0),
      currentRank: row.currentRank,
      teamKey: row.teamKey,
    };
    if (compareProjected(other, us) < 0) ahead += 1;
  }
  return ahead + 1;
}

/**
 * Provable floor on our seed: teams whose WORST reachable ranking-point total
 * still beats our BEST reachable total can never be passed, no matter which
 * candidate outcomes we force. floor = unpassable + 1.
 */
function floorRankFor(
  ourKey: string,
  standings: StandingTeam[],
  remainingMatches: RemainingMatch[],
  candidateKeys: Set<string>,
  baselineOverrides: OutcomeOverrides,
  rules: RankingPointRules,
): number {
  const known = new Set(standings.map((team) => team.teamKey));
  const best = new Map<string, number>();
  const worst = new Map<string, number>();
  for (const team of standings) {
    best.set(team.teamKey, team.rankingPoints);
    worst.set(team.teamKey, team.rankingPoints);
  }
  for (const match of remainingMatches) {
    const controllable = candidateKeys.has(match.matchKey);
    const baseOutcome = outcomeFor(match, baselineOverrides);
    const ourSide = sideOf(match, ourKey);
    const sides: Array<[AllianceSide, string[]]> = [
      ["red", match.red ?? []],
      ["blue", match.blue ?? []],
    ];
    for (const [side, teams] of sides) {
      for (const teamKey of teams) {
        if (!known.has(teamKey)) continue;
        if (!controllable) {
          const fixed = baseOutcome == null ? 0 : rpFor(rules, baseOutcome, side);
          best.set(teamKey, (best.get(teamKey) ?? 0) + fixed);
          worst.set(teamKey, (worst.get(teamKey) ?? 0) + fixed);
          continue;
        }
        if (teamKey === ourKey) {
          best.set(teamKey, (best.get(teamKey) ?? 0) + rules.win);
          worst.set(teamKey, (worst.get(teamKey) ?? 0) + rules.win);
          continue;
        }
        if (ourSide != null) {
          // Our own match: forcing our alliance to win fixes everyone else in it.
          const fixed = rpFor(rules, ourSide, side);
          best.set(teamKey, (best.get(teamKey) ?? 0) + fixed);
          worst.set(teamKey, (worst.get(teamKey) ?? 0) + fixed);
          continue;
        }
        best.set(teamKey, (best.get(teamKey) ?? 0) + rules.win);
        worst.set(teamKey, (worst.get(teamKey) ?? 0) + rules.loss);
      }
    }
  }
  const ourBest = best.get(ourKey);
  if (ourBest == null) return 1;
  let unpassable = 0;
  for (const team of standings) {
    if (team.teamKey === ourKey) continue;
    if ((worst.get(team.teamKey) ?? 0) > ourBest) unpassable += 1;
  }
  return unpassable + 1;
}

function flipOptions(match: RemainingMatch): AllianceOutcome[] {
  const options: AllianceOutcome[] = [];
  for (const outcome of ["red", "blue"] as const) {
    if (match.predicted === outcome) continue;
    options.push(outcome);
  }
  return options;
}

/**
 * Smallest set of forced outcomes that reaches the best seed the search can find.
 *
 * Search space: remaining matches involving us, then matches involving teams
 * within `rankWindow` seeds of us — capped at `maxCandidates`, searched by
 * increasing flip count up to `maxDepth`, bounded by `maxEvaluations` and by a
 * provable rank floor. Matches the user already forced stay as the user set them.
 */
export function bestPath(input: {
  teamKey: string;
  standings: StandingTeam[];
  remainingMatches: RemainingMatch[];
  overrides?: OutcomeOverrides;
  rules?: RankingPointRules;
  limits?: Partial<BestPathLimits>;
}): BestPathResult {
  const limits: BestPathLimits = { ...DEFAULT_BEST_PATH_LIMITS, ...(input.limits ?? {}) };
  const rules = input.rules ?? DEFAULT_RANKING_POINT_RULES;
  const overrides = input.overrides ?? {};
  const baseline = seedProjection(input.standings, input.remainingMatches, overrides, rules);
  const baselineRank = projectedRankOf(baseline, input.teamKey);

  const empty = (reason: string | null, floorRank: number | null): BestPathResult => ({
    teamKey: input.teamKey,
    baselineRank,
    bestRank: baselineRank,
    flips: [],
    candidateMatches: 0,
    consideredMatches: input.remainingMatches.length,
    evaluations: 0,
    depthSearched: 0,
    capped: false,
    cappedReason: reason,
    floorRank,
    limits,
  });

  if (baselineRank == null) return empty("No standings row for this team — nothing to project.", null);

  const openMatches = input.remainingMatches.filter((match) => match && !(match.matchKey in overrides));
  if (!openMatches.length) return empty("Every remaining match is already forced by hand.", baselineRank);

  const rivalKeys = new Set<string>();
  for (const row of baseline.rows) {
    if (row.teamKey === input.teamKey) continue;
    if (Math.abs(row.projectedRank - baselineRank) <= limits.rankWindow) rivalKeys.add(row.teamKey);
  }

  const byMatchOrder = (a: RemainingMatch, b: RemainingMatch) =>
    a.matchNumber !== b.matchNumber
      ? a.matchNumber - b.matchNumber
      : a.matchKey < b.matchKey
        ? -1
        : a.matchKey > b.matchKey
          ? 1
          : 0;

  // Our own matches are the highest-value levers, so they are never squeezed out.
  const ourMatches = openMatches
    .filter((match) => sideOf(match, input.teamKey) != null)
    .sort(byMatchOrder);
  const rivalMatches = openMatches
    .filter(
      (match) =>
        sideOf(match, input.teamKey) == null &&
        [...(match.red ?? []), ...(match.blue ?? [])].some((teamKey) => rivalKeys.has(teamKey)),
    )
    .sort(byMatchOrder);
  const prioritised = [...ourMatches, ...rivalMatches];
  const truncated = prioritised.length > limits.maxCandidates;
  const candidates = prioritised.slice(0, limits.maxCandidates);

  const matchByKey = new Map(input.remainingMatches.map((match) => [match.matchKey, match]));
  const candidateKeys = new Set(candidates.map((match) => match.matchKey));
  const floorRank = floorRankFor(
    input.teamKey,
    input.standings,
    input.remainingMatches,
    candidateKeys,
    overrides,
    rules,
  );

  if (!candidates.length) {
    return {
      ...empty("No remaining match involves your team or a team near your seed.", floorRank),
      consideredMatches: openMatches.length,
    };
  }

  if (baselineRank <= floorRank) {
    return {
      teamKey: input.teamKey,
      baselineRank,
      bestRank: baselineRank,
      flips: [],
      candidateMatches: candidates.length,
      consideredMatches: openMatches.length,
      evaluations: 0,
      depthSearched: 0,
      capped: truncated,
      cappedReason: truncated
        ? "Only the first " + limits.maxCandidates + " relevant matches were searched."
        : "Already the best reachable seed — no combination of results moves you up.",
      floorRank,
      limits,
    };
  }

  let bestRank = baselineRank;
  let bestFlips: BestPathFlip[] = [];
  let evaluations = 0;
  let budgetHit = false;
  let depthSearched = 0;

  const optionsByIndex = candidates.map((match) => flipOptions(match));

  const evaluate = (flips: BestPathFlip[]) => {
    evaluations += 1;
    const rank = rankAfterFlips(baseline, overrides, input.teamKey, flips, matchByKey, rules);
    if (rank != null && rank < bestRank) {
      bestRank = rank;
      bestFlips = flips.map((flip) => ({ ...flip }));
    }
  };

  const proven = () => bestRank <= floorRank;

  const walk = (start: number, remaining: number, chosen: BestPathFlip[]): void => {
    if (remaining === 0) {
      evaluate(chosen);
      return;
    }
    for (let index = start; index <= candidates.length - remaining; index += 1) {
      const match = candidates[index];
      if (!match) continue;
      for (const outcome of optionsByIndex[index] ?? []) {
        if (evaluations >= limits.maxEvaluations) {
          budgetHit = true;
          return;
        }
        if (proven()) return;
        chosen.push({
          matchKey: match.matchKey,
          matchNumber: match.matchNumber,
          red: match.red ?? [],
          blue: match.blue ?? [],
          outcome,
          predicted: match.predicted ?? null,
          ourSide: sideOf(match, input.teamKey),
        });
        walk(index + 1, remaining - 1, chosen);
        chosen.pop();
        if (budgetHit || proven()) return;
      }
    }
  };

  const maxDepth = Math.min(limits.maxDepth, candidates.length);
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    depthSearched = depth;
    walk(0, depth, []);
    if (budgetHit || proven()) break;
  }

  const notExhaustive = maxDepth < candidates.length && !proven();
  const capped = truncated || budgetHit || notExhaustive;
  const reasons: string[] = [];
  if (truncated) {
    reasons.push(
      prioritised.length +
        " relevant matches were narrowed to the " +
        limits.maxCandidates +
        " nearest your seed.",
    );
  }
  if (budgetHit) reasons.push("Search stopped at the " + limits.maxEvaluations + "-scenario budget.");
  if (notExhaustive && !budgetHit) {
    reasons.push("Searched up to " + maxDepth + " simultaneous flips, not every combination.");
  }
  if (!capped && proven()) reasons.push("Best reachable seed proven — no combination does better.");

  return {
    teamKey: input.teamKey,
    baselineRank,
    bestRank,
    flips: bestFlips,
    candidateMatches: candidates.length,
    consideredMatches: openMatches.length,
    evaluations,
    depthSearched,
    capped,
    cappedReason: reasons.length ? reasons.join(" ") : null,
    floorRank,
    limits,
  };
}

const teamLabel = (teamKey: string) => teamKey.replace(/^frc/i, "") || teamKey;

/** "Beat 254 in Q78" / "1678 loses Q81" — plain language for the plan list. */
export function describeFlip(flip: BestPathFlip, ourTeamKey?: string): string {
  const label = "Q" + flip.matchNumber;
  const side =
    flip.ourSide ??
    (ourTeamKey
      ? (flip.red ?? []).includes(ourTeamKey)
        ? "red"
        : (flip.blue ?? []).includes(ourTeamKey)
          ? "blue"
          : null
      : null);
  if (side) {
    const opponents = (side === "red" ? flip.blue : flip.red).map(teamLabel).join(", ");
    if (flip.outcome === "tie") return "Tie " + (opponents || "your opponents") + " in " + label;
    if (flip.outcome === side) return "Beat " + (opponents || "your opponents") + " in " + label;
    return "Lose to " + (opponents || "your opponents") + " in " + label;
  }
  if (flip.outcome === "tie") {
    const red = (flip.red ?? []).map(teamLabel).join(", ") || "red";
    const blue = (flip.blue ?? []).map(teamLabel).join(", ") || "blue";
    return label + " ends in a tie (" + red + " vs " + blue + ")";
  }
  const losers = (flip.outcome === "red" ? flip.blue : flip.red).map(teamLabel).join(", ");
  const winners = (flip.outcome === "red" ? flip.red : flip.blue).map(teamLabel).join(", ");
  return (
    (losers || "the other alliance") + " loses " + label + (winners ? " to " + winners : "")
  );
}

export function describeBestPath(result: BestPathResult): string {
  if (result.baselineRank == null) return "No standings row yet — nothing to plan from.";
  if (!result.flips.length) {
    return result.bestRank === result.baselineRank
      ? "Seed " + result.baselineRank + " is already the best this search can reach."
      : "Seed " + result.baselineRank + ".";
  }
  return (
    result.flips.length +
    " outcome" +
    (result.flips.length === 1 ? "" : "s") +
    " move you from seed " +
    result.baselineRank +
    " to seed " +
    result.bestRank +
    "."
  );
}
