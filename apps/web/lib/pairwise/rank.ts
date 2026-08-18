export type PairwiseResult = {
  winnerTeamNumber: number;
  loserTeamNumber: number;
};

export type PairwiseRank = {
  teamNumber: number;
  wins: number;
  losses: number;
  comparisons: number;
  /** Bradley-Terry strength. Relative only — never a TBA rank or EPA. */
  strength: number;
  rank: number;
};

function pairDirectedKey(winner: number, loser: number): string {
  return `${winner}>${loser}`;
}

/**
 * Bradley-Terry ranking from A-beats-B taps.
 * Empty input stays empty — no invented field ranking.
 */
export function rankPairwise(results: PairwiseResult[], iterations = 40): PairwiseRank[] {
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  const directed = new Map<string, number>();
  const teams = new Set<number>();

  for (const result of results) {
    const winner = Math.round(result.winnerTeamNumber);
    const loser = Math.round(result.loserTeamNumber);
    if (!Number.isInteger(winner) || !Number.isInteger(loser) || winner === loser) continue;
    if (winner < 1 || loser < 1 || winner > 99_999 || loser > 99_999) continue;
    teams.add(winner);
    teams.add(loser);
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
    losses.set(loser, (losses.get(loser) ?? 0) + 1);
    directed.set(pairDirectedKey(winner, loser), (directed.get(pairDirectedKey(winner, loser)) ?? 0) + 1);
  }

  const ids = [...teams].sort((a, b) => a - b);
  if (!ids.length) return [];

  const strength = new Map(ids.map((id) => [id, 1]));
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Map<number, number>();
    for (const i of ids) {
      const winCount = wins.get(i) ?? 0;
      let denom = 0;
      const si = strength.get(i) ?? 1;
      for (const j of ids) {
        if (i === j) continue;
        const n =
          (directed.get(pairDirectedKey(i, j)) ?? 0) + (directed.get(pairDirectedKey(j, i)) ?? 0);
        if (!n) continue;
        denom += n / (si + (strength.get(j) ?? 1));
      }
      next.set(i, denom > 0 ? winCount / denom : si);
    }
    const positive = ids.map((id) => next.get(id) ?? 1).filter((value) => value > 0);
    const geo =
      positive.length > 0
        ? Math.exp(positive.reduce((sum, value) => sum + Math.log(value), 0) / positive.length)
        : 1;
    for (const id of ids) {
      strength.set(id, (next.get(id) ?? 1) / (geo || 1));
    }
  }

  return ids
    .map((teamNumber) => {
      const winCount = wins.get(teamNumber) ?? 0;
      const lossCount = losses.get(teamNumber) ?? 0;
      return {
        teamNumber,
        wins: winCount,
        losses: lossCount,
        comparisons: winCount + lossCount,
        strength: strength.get(teamNumber) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.strength - a.strength || b.wins - a.wins || a.teamNumber - b.teamNumber,
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function parseTeamNumber(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 99_999) return null;
  return number;
}
