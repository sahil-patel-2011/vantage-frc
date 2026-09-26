/**
 * Where each team is likely to finish the qualification rounds, as odds rather than one guess.
 *
 * A single projected seed ("we finish 6th") hides the question a drive team actually asks the
 * night before alliance selection: how likely are we to be a captain? This plays out the rest of
 * the schedule many times (10,000 by default), each match decided by its win probability, and
 * counts where every team lands.
 *
 * Inputs are only what is known: ranking points already banked (official), the remaining
 * schedule (official), each remaining match's win probability (the prediction the app already
 * shows, or null), and optionally each team's average bonus ranking points per match so far
 * (official). A match with no prediction is played as a coin flip and counted, so the result can
 * say how much of it rests on guesses. The random stream is seeded, so the same inputs always
 * give the same odds.
 */

export type SeedOddsStanding = {
  teamKey: string;
  rankingPoints: number;
  played: number;
  /** Official current rank; breaks projected ties the way the event's real sort orders would. */
  currentRank: number | null;
  /** Average bonus RP per match so far (official), added in expectation to each remaining match. */
  bonusRpPerMatch?: number;
};

export type SeedOddsMatch = {
  matchKey: string;
  red: string[];
  blue: string[];
  /** Chance red wins, 0–1, or null when there is no prediction. */
  redWinProbability: number | null;
};

export type SeedOddsRules = { win: number; tie: number; loss: number };

export type TeamSeedOdds = {
  teamKey: string;
  /** Chance of finishing in the top `captains` seeds (alliance captain before any declines). */
  captainChance: number;
  firstSeedChance: number;
  medianSeed: number;
  /** 10th and 90th percentile seed: "usually between". */
  bestLikelySeed: number;
  worstLikelySeed: number;
};

export type SeedOdds = {
  iterations: number;
  captains: number;
  teams: TeamSeedOdds[];
  /** Remaining matches played as coin flips because nothing predicted them. */
  unpredictedMatches: number;
  remainingMatches: number;
};

export const DEFAULT_SEED_ITERATIONS = 10_000;
export const DEFAULT_CAPTAINS = 8;

/** mulberry32: small, fast, and good enough to deal matches; seeded so results repeat. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1) + 0.5)))]!;
}

export function seedOdds(input: {
  standings: readonly SeedOddsStanding[];
  remaining: readonly SeedOddsMatch[];
  rules: SeedOddsRules;
  iterations?: number;
  captains?: number;
}): SeedOdds {
  const iterations = Math.max(100, Math.min(50_000, Math.floor(input.iterations ?? DEFAULT_SEED_ITERATIONS)));
  const captains = input.captains ?? DEFAULT_CAPTAINS;
  const teams = input.standings.map((row) => row.teamKey);
  const index = new Map(teams.map((team, i) => [team, i]));
  const n = teams.length;
  const remaining = input.remaining.filter((match) =>
    [...match.red, ...match.blue].every((team) => index.has(team)),
  );
  const unpredicted = remaining.filter((match) => match.redWinProbability == null).length;

  // Expected bonus RP each team adds over its remaining matches (deterministic).
  const base = new Float64Array(n);
  const remainingCount = new Float64Array(n);
  for (const match of remaining) for (const team of [...match.red, ...match.blue]) remainingCount[index.get(team)!]! += 1;
  input.standings.forEach((row, i) => {
    base[i] = row.rankingPoints + Math.max(0, row.bonusRpPerMatch ?? 0) * remainingCount[i]!;
  });
  // Tiebreak: current rank first, then team key, so ties resolve the same way every run.
  const tieOrder = [...teams.keys()].sort((a, b) => {
    const ra = input.standings[a]!.currentRank ?? Number.MAX_SAFE_INTEGER;
    const rb = input.standings[b]!.currentRank ?? Number.MAX_SAFE_INTEGER;
    return ra - rb || teams[a]!.localeCompare(teams[b]!);
  });
  const tieRank = new Int32Array(n);
  tieOrder.forEach((teamIndex, position) => {
    tieRank[teamIndex] = position;
  });

  const plan = remaining.map((match) => ({
    red: match.red.map((team) => index.get(team)!),
    blue: match.blue.map((team) => index.get(team)!),
    p: match.redWinProbability == null ? 0.5 : Math.min(1, Math.max(0, match.redWinProbability)),
  }));
  const random = rng(seedFrom(remaining.map((match) => match.matchKey).join("|") + ":" + teams.join(",")));
  const seeds: number[][] = Array.from({ length: n }, () => []);
  const rp = new Float64Array(n);
  const order = [...teams.keys()];

  for (let run = 0; run < iterations; run += 1) {
    rp.set(base);
    for (const match of plan) {
      const redWins = random() < match.p;
      for (const i of match.red) rp[i]! += redWins ? input.rules.win : input.rules.loss;
      for (const i of match.blue) rp[i]! += redWins ? input.rules.loss : input.rules.win;
    }
    order.sort((a, b) => rp[b]! - rp[a]! || tieRank[a]! - tieRank[b]!);
    order.forEach((teamIndex, position) => seeds[teamIndex]!.push(position + 1));
  }

  const rows = teams.map((teamKey, i) => {
    const sorted = seeds[i]!.sort((a, b) => a - b);
    const top = sorted.filter((seed) => seed <= captains).length;
    const first = sorted.filter((seed) => seed === 1).length;
    return {
      teamKey,
      captainChance: top / iterations,
      firstSeedChance: first / iterations,
      medianSeed: percentile(sorted, 0.5),
      bestLikelySeed: percentile(sorted, 0.1),
      worstLikelySeed: percentile(sorted, 0.9),
    };
  });
  rows.sort((a, b) => a.medianSeed - b.medianSeed || b.captainChance - a.captainChance);
  return { iterations, captains, teams: rows, unpredictedMatches: unpredicted, remainingMatches: remaining.length };
}
