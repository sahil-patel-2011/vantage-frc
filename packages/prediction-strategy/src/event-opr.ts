/**
 * Offensive Power Rating from this event's official results, with recent matches counted more.
 *
 * OPR is the number every FRC strategist already knows: the least-squares answer to "what does
 * each robot add, if an alliance's score is the sum of its three robots?". It comes from the
 * official scores alone, so it is a cross-check on scouting that no scout can bias, and with the
 * official score breakdown it splits into auto, teleop and endgame the same way.
 *
 * Two changes from the textbook version, both standard in competitive scouting tools:
 *
 * 1. **Time decay.** A robot on its eighth qual is not the robot from its first; its early
 *    matches are weighted down by `decay^(age)`, where age counts that event's later matches.
 *    `decay = 1` gives plain OPR.
 * 2. **A small ridge term.** Early in an event the system is underdetermined (more robots than
 *    alliance scores) and plain least squares swings wildly. The ridge pulls every robot gently
 *    toward the event's per-robot average instead of toward zero, so a robot with one match does
 *    not read as a superstar or a brick.
 *
 * Nothing is invented: a robot is only rated once it has played `MIN_MATCHES_FOR_OPR` matches,
 * and a component is only rated when every counted alliance had that component on its breakdown.
 */

export type OprComponent = "total" | "auto" | "teleop" | "endgame";

/** One alliance's official result in one match. */
export type AllianceResult = {
  matchKey: string;
  /** Order the match was played in (qual number is fine); later = more recent. */
  order: number;
  teamKeys: string[];
  /** Official alliance score with fouls drawn by the other alliance removed where known. */
  total: number;
  auto?: number | null;
  teleop?: number | null;
  endgame?: number | null;
};

export type TeamOpr = {
  teamKey: string;
  matches: number;
  total: number;
  auto: number | null;
  teleop: number | null;
  endgame: number | null;
};

/** Fewer than this and a robot's OPR is mostly its partners'. */
export const MIN_MATCHES_FOR_OPR = 3;
/** Each later match multiplies an older one's weight by this. */
export const DEFAULT_OPR_DECAY = 0.93;
/** Ridge strength, in units of "matches' worth" of pull toward the event average. */
export const DEFAULT_OPR_RIDGE = 0.5;

/**
 * Solves (AᵀWA + λI)x = AᵀWb + λ·prior by Cholesky. A is teams × alliances with 1 where a team
 * played; W holds the decay weights. Returns null when there is nothing to solve.
 */
function solveComponent(
  results: readonly AllianceResult[],
  teams: readonly string[],
  value: (row: AllianceResult) => number | null | undefined,
  decay: number,
  ridge: number,
): number[] | null {
  const counted = results.filter((row) => {
    const v = value(row);
    return v != null && Number.isFinite(v);
  });
  if (!counted.length) return null;
  const index = new Map(teams.map((team, i) => [team, i]));
  const n = teams.length;
  const latestOrder = Math.max(...counted.map((row) => row.order));
  const orders = [...new Set(counted.map((row) => row.order))].sort((a, b) => b - a);
  const age = new Map(orders.map((order, i) => [order, i]));

  const ata = Array.from({ length: n }, () => new Float64Array(n));
  const atb = new Float64Array(n);
  let weightedSum = 0;
  let weightedSlots = 0;
  for (const row of counted) {
    const weight = decay ** (age.get(row.order) ?? latestOrder - row.order);
    const members = row.teamKeys.map((team) => index.get(team)).filter((i): i is number => i != null);
    const v = value(row)!;
    for (const i of members) {
      atb[i]! += weight * v;
      for (const j of members) ata[i]![j]! += weight;
    }
    weightedSum += weight * v;
    weightedSlots += weight * Math.max(1, row.teamKeys.length);
  }
  const prior = weightedSlots > 0 ? weightedSum / weightedSlots : 0;
  for (let i = 0; i < n; i += 1) {
    ata[i]![i]! += ridge;
    atb[i]! += ridge * prior;
  }

  // Cholesky: ata = L·Lᵀ (symmetric positive definite thanks to the ridge).
  const l = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = ata[i]![j]!;
      for (let k = 0; k < j; k += 1) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (sum <= 0) return null;
        l[i]![i] = Math.sqrt(sum);
      } else {
        l[i]![j] = sum / l[j]![j]!;
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = atb[i]!;
    for (let k = 0; k < i; k += 1) sum -= l[i]![k]! * y[k]!;
    y[i] = sum / l[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k += 1) sum -= l[k]![i]! * x[k]!;
    x[i] = sum / l[i]![i]!;
  }
  return x;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Event OPR for every robot with enough matches, best total first. Components that were missing
 * from any counted breakdown come back null rather than guessed.
 */
export function eventOpr(
  results: readonly AllianceResult[],
  options: { decay?: number; ridge?: number; minMatches?: number } = {},
): TeamOpr[] {
  const decay = Math.min(1, Math.max(0.5, options.decay ?? DEFAULT_OPR_DECAY));
  const ridge = Math.max(1e-6, options.ridge ?? DEFAULT_OPR_RIDGE);
  const minMatches = options.minMatches ?? MIN_MATCHES_FOR_OPR;

  const played = new Map<string, number>();
  for (const row of results) for (const team of row.teamKeys) played.set(team, (played.get(team) ?? 0) + 1);
  const teams = [...played.keys()].sort();
  if (!teams.length) return [];

  const everyRow = (pick: (row: AllianceResult) => number | null | undefined) =>
    results.every((row) => {
      const v = pick(row);
      return v != null && Number.isFinite(v);
    });
  const solve = (pick: (row: AllianceResult) => number | null | undefined, required: boolean) =>
    required && !everyRow(pick) ? null : solveComponent(results, teams, pick, decay, ridge);

  const total = solve((row) => row.total, false);
  if (!total) return [];
  const auto = solve((row) => row.auto, true);
  const teleop = solve((row) => row.teleop, true);
  const endgame = solve((row) => row.endgame, true);

  return teams
    .map((teamKey, i) => ({
      teamKey,
      matches: played.get(teamKey) ?? 0,
      total: round1(total[i]!),
      auto: auto ? round1(auto[i]!) : null,
      teleop: teleop ? round1(teleop[i]!) : null,
      endgame: endgame ? round1(endgame[i]!) : null,
    }))
    .filter((row) => row.matches >= minMatches)
    .sort((a, b) => b.total - a.total);
}
