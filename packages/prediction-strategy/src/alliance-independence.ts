/**
 * Does this team win because of its alliance, or in spite of it?
 *
 * Rankings and ratings answer "how good is this team" but not the question a
 * pick list actually turns on: whether a team's results hold up when the two
 * robots beside it are weak. A 40-point robot that only wins alongside other
 * 40-point robots is a different pick from a 35-point robot that drags poor
 * alliances to wins.
 *
 * The method is deliberately simple, because the sample is small — a team plays
 * roughly twelve qualification matches. Split that team's matches by how strong
 * its partners were, compare the win rate in each half, and say what the split
 * shows. No model, no fitting: with twelve matches anything fancier is
 * describing noise.
 */

export type TeamMatchRecord = {
  matchKey: string;
  /** True when this team's alliance won. Ties are neither, and are excluded. */
  won: boolean;
  /** Rating of the two robots on this team's alliance, excluding this team. */
  partnerRating: number;
};

export type IndependenceVerdict =
  | "carries"
  | "steady"
  | "needs-partners"
  | "unknown";

export type AllianceIndependence = {
  verdict: IndependenceVerdict;
  /** Plain sentence for a student reading a pick list. */
  summary: string;
  /** Win rate with the weaker half of this team's partners, 0–1. */
  winRateWeakPartners: number;
  /** Win rate with the stronger half, 0–1. */
  winRateStrongPartners: number;
  /** strong − weak. Large means the result follows the partners, not the team. */
  partnerSwing: number;
  matchesCounted: number;
};

/**
 * Fewer than this and the two halves are too small to compare — a team that
 * went 2-1 with weak partners has told you almost nothing.
 */
export const MIN_MATCHES_FOR_INDEPENDENCE = 6;
/** Each half needs its own floor, or a lopsided schedule fakes a split. */
export const MIN_PER_HALF = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

function rate(wins: number, total: number): number {
  return total === 0 ? 0 : wins / total;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Split a team's matches at the median partner strength and compare.
 *
 * Returns an "unknown" verdict rather than a number when there is not enough to
 * look at. A pick list that says "needs partners" off three matches is worse
 * than one that admits it does not know yet.
 */
export function allianceIndependence(records: TeamMatchRecord[]): AllianceIndependence {
  const usable = records.filter(
    (record) => Number.isFinite(record.partnerRating) && record.partnerRating >= 0,
  );

  const unknown = (matchesCounted: number): AllianceIndependence => ({
    verdict: "unknown",
    summary:
      matchesCounted === 0
        ? "No scored matches for this team yet."
        : `Only ${matchesCounted} scored ${matchesCounted === 1 ? "match" : "matches"} — not enough to tell yet.`,
    winRateWeakPartners: 0,
    winRateStrongPartners: 0,
    partnerSwing: 0,
    matchesCounted,
  });

  if (usable.length < MIN_MATCHES_FOR_INDEPENDENCE) return unknown(usable.length);

  const cut = median(usable.map((record) => record.partnerRating));
  // Strictly-below keeps the split honest when many partners share a rating;
  // the equal cases go to the stronger half so "weak" never overstates itself.
  const weak = usable.filter((record) => record.partnerRating < cut);
  const strong = usable.filter((record) => record.partnerRating >= cut);
  if (weak.length < MIN_PER_HALF || strong.length < MIN_PER_HALF) return unknown(usable.length);

  const weakRate = rate(weak.filter((record) => record.won).length, weak.length);
  const strongRate = rate(strong.filter((record) => record.won).length, strong.length);
  const swing = strongRate - weakRate;

  let verdict: IndependenceVerdict;
  let summary: string;
  if (weakRate >= 0.6) {
    verdict = "carries";
    summary = `Wins with weak partners too — ${Math.round(weakRate * 100)}% with the weaker half of its alliances.`;
  } else if (swing >= 0.4) {
    verdict = "needs-partners";
    summary = `Results follow the alliance — ${Math.round(strongRate * 100)}% with strong partners, ${Math.round(weakRate * 100)}% without.`;
  } else {
    verdict = "steady";
    summary = `About the same either way — ${Math.round(weakRate * 100)}% with weak partners, ${Math.round(strongRate * 100)}% with strong.`;
  }

  return {
    verdict,
    summary,
    winRateWeakPartners: round3(weakRate),
    winRateStrongPartners: round3(strongRate),
    partnerSwing: round3(swing),
    matchesCounted: usable.length,
  };
}

/** Short label for a pick-list chip. Never a bare colour or an icon alone. */
export function independenceLabel(verdict: IndependenceVerdict): string {
  switch (verdict) {
    case "carries":
      return "Wins with any alliance";
    case "needs-partners":
      return "Needs a strong partner";
    case "steady":
      return "Steady either way";
    default:
      return "Not enough matches";
  }
}
