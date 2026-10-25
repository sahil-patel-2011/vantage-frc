/**
 * Replay qualification seeding for 2026gagr from the public match file.
 *
 * The final order is derived here, not read from a ranking table: the file has
 * scores and foul points, not ranking points. Assumptions are stated on
 * `deriveQualOrder` and checked against the public rankings in the test.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allianceWinProbability, allianceWinProbabilityForEvent } from "../src/alliance-outcome";
import { eventOpr, type AllianceResult } from "../src/event-opr";
import { seedOdds } from "../src/seed-odds";

export type Qual = {
  /** 1-based position in the qualification schedule. */
  number: number;
  red: string[];
  blue: string[];
  redScore: number;
  blueScore: number;
  redFouls: number;
  blueFouls: number;
};

const WIN = 3;
const TIE = 1;

export function loadGagrQuals(): Qual[] {
  const quals: Qual[] = [];
  for (const line of readFileSync(join(__dirname, "fixtures/gagai-gagr-played-matches.csv"), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [event, level, red, blue, redScore, blueScore, redFouls, blueFouls] = line.split(",");
    if (event !== "2026gagr" || level !== "qm") continue;
    quals.push({
      number: quals.length + 1,
      red: red!.split(" ").map((team) => `frc${team}`),
      blue: blue!.split(" ").map((team) => `frc${team}`),
      redScore: Number(redScore),
      blueScore: Number(blueScore),
      redFouls: Number(redFouls),
      blueFouls: Number(blueFouls),
    });
  }
  return quals;
}

type Standing = {
  teamKey: string;
  rp: number;
  played: number;
  /** Sum of alliance score with foul points drawn removed. */
  earned: number;
};

/**
 * Rank by win/tie ranking points per match, then average foul-free score, then team number.
 *
 * 2026 REBUILT awards 3 ranking points for a win and 1 for a tie, plus up to three bonus
 * ranking points this file cannot see (fuel and tower thresholds). Bonus points are not
 * awarded here. Foul-free average score is the tiebreak because it matched the public
 * "Avg Match" column for every team that played eight matches.
 */
export function deriveQualOrder(quals: readonly Qual[]): { order: string[]; standings: Standing[] } {
  const byTeam = new Map<string, Standing>();
  const touch = (teamKey: string): Standing => {
    let row = byTeam.get(teamKey);
    if (!row) {
      row = { teamKey, rp: 0, played: 0, earned: 0 };
      byTeam.set(teamKey, row);
    }
    return row;
  };
  for (const qual of quals) {
    const redRp = pointsFor(qual.redScore, qual.blueScore);
    const blueRp = pointsFor(qual.blueScore, qual.redScore);
    for (const teamKey of qual.red) add(touch(teamKey), redRp, Math.max(0, qual.redScore - qual.redFouls));
    for (const teamKey of qual.blue) add(touch(teamKey), blueRp, Math.max(0, qual.blueScore - qual.blueFouls));
  }
  const standings = [...byTeam.values()].sort(compareStandings);
  return { order: standings.map((row) => row.teamKey), standings };
}

function pointsFor(ourScore: number, theirScore: number): number {
  if (ourScore > theirScore) return WIN;
  if (ourScore < theirScore) return 0;
  return TIE;
}

function add(row: Standing, rp: number, earned: number) {
  row.rp += rp;
  row.played += 1;
  row.earned += earned;
}

function compareStandings(a: Standing, b: Standing): number {
  const rp = b.rp * a.played - a.rp * b.played;
  if (rp !== 0) return rp;
  const earned = b.earned * a.played - a.earned * b.played;
  if (earned !== 0) return earned;
  return a.teamKey.localeCompare(b.teamKey, "en", { numeric: true });
}

function alliancesOf(quals: readonly Qual[]): AllianceResult[] {
  const out: AllianceResult[] = [];
  for (const qual of quals) {
    out.push({
      matchKey: `2026gagr_qm${qual.number}r`,
      order: qual.number,
      teamKeys: qual.red,
      total: Math.max(0, qual.redScore - qual.redFouls),
    });
    out.push({
      matchKey: `2026gagr_qm${qual.number}b`,
      order: qual.number,
      teamKeys: qual.blue,
      total: Math.max(0, qual.blueScore - qual.blueFouls),
    });
  }
  return out;
}

export type SeedModel = "before" | "frozen" | "ratings-fixed-curve" | "ratings-event-curve";

export type CutoffMeasure = {
  playedQuals: number;
  remainingQuals: number;
  model: SeedModel;
  spearmanDerived: number;
  top8Derived: number;
  spearmanOfficial: number;
  top8Official: number;
  unpredicted: number;
  /** Winner calls among decided remaining matches that had a rating. Null for the frozen order. */
  winnersRight: number | null;
  winnerCalls: number | null;
  brier: number | null;
  scale: number | null;
};

export function measureCutoff(
  quals: readonly Qual[],
  playedQuals: number,
  officialOrder: readonly string[],
  model: SeedModel,
): CutoffMeasure {
  const played = quals.slice(0, playedQuals);
  const remaining = quals.slice(playedQuals);
  const now = deriveQualOrder(played);
  const finalOrder = deriveQualOrder(quals).order;
  const results = alliancesOf(played);
  const opr = new Map(eventOpr(results, { decay: 1, minMatches: 1 }).map((row) => [row.teamKey, row.total]));
  const level = results.length
    ? Math.round((results.reduce((sum, row) => sum + row.total, 0) / results.length) * 10) / 10
    : null;
  const scale = model === "ratings-event-curve" && level != null ? 0.3 * level : model === "ratings-fixed-curve" ? 12 : null;

  const currentRank = new Map(now.order.map((teamKey, index) => [teamKey, index + 1]));
  let unpredicted = 0;
  let brierSum = 0;
  let brierN = 0;
  let winnersRight = 0;
  let winnerCalls = 0;
  const rates = model === "ratings-fixed-curve" || model === "ratings-event-curve";
  const remainingInput = remaining.map((qual) => {
    const redRating = rates ? totalRating(qual.red, opr) : null;
    const blueRating = rates ? totalRating(qual.blue, opr) : null;
    const redWinProbability =
      redRating != null && blueRating != null
        ? model === "ratings-event-curve"
          ? allianceWinProbabilityForEvent(redRating, blueRating, level)
          : allianceWinProbability(redRating, blueRating)
        : null;
    if (model !== "frozen" && redWinProbability == null) unpredicted += 1;
    const chance = model === "before" ? 0.5 : redWinProbability;
    if (model !== "frozen" && qual.redScore !== qual.blueScore && chance != null) {
      const redWon = qual.redScore > qual.blueScore;
      brierSum += (chance - (redWon ? 1 : 0)) ** 2;
      brierN += 1;
      if (rates && chance !== 0.5) {
        winnerCalls += 1;
        if ((chance > 0.5) === redWon) winnersRight += 1;
      }
    }
    return {
      matchKey: `2026gagr_qm${qual.number}`,
      red: qual.red,
      blue: qual.blue,
      redWinProbability: model === "before" || model === "frozen" ? null : redWinProbability,
    };
  });

  const projected =
    model === "frozen"
      ? now.order
      : seedOdds({
          standings: now.standings.map((row) => ({
            teamKey: row.teamKey,
            rankingPoints: row.rp,
            played: row.played,
            currentRank: currentRank.get(row.teamKey) ?? null,
          })),
          remaining: remainingInput,
          rules: { win: WIN, tie: TIE, loss: 0 },
        }).teams.map((row) => row.teamKey);

  return {
    playedQuals,
    remainingQuals: remaining.length,
    model,
    spearmanDerived: spearman(projected, finalOrder),
    top8Derived: overlap(projected, finalOrder, 8),
    spearmanOfficial: spearman(projected, officialOrder),
    top8Official: overlap(projected, officialOrder, 8),
    unpredicted: model === "frozen" ? remaining.length : unpredicted,
    winnersRight: rates ? winnersRight : null,
    winnerCalls: rates ? winnerCalls : null,
    brier: brierN ? brierSum / brierN : null,
    scale,
  };
}

function totalRating(teams: readonly string[], opr: ReadonlyMap<string, number>): number | null {
  let sum = 0;
  for (const teamKey of teams) {
    const rating = opr.get(teamKey);
    if (rating == null || !Number.isFinite(rating)) return null;
    sum += rating;
  }
  return sum;
}

export function spearman(projected: readonly string[], actual: readonly string[]): number {
  if (projected.length !== actual.length) throw new Error("rank lists cover different teams");
  const actualRank = new Map(actual.map((teamKey, index) => [teamKey, index + 1]));
  const xs: number[] = [];
  const ys: number[] = [];
  projected.forEach((teamKey, index) => {
    const rank = actualRank.get(teamKey);
    if (rank == null) throw new Error(`missing ${teamKey}`);
    xs.push(index + 1);
    ys.push(rank);
  });
  return pearson(xs, ys);
}

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = xs[i]! - meanX;
    const vy = ys[i]! - meanY;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  return dx === 0 || dy === 0 ? 1 : num / Math.sqrt(dx * dy);
}

function overlap(projected: readonly string[], actual: readonly string[], count: number): number {
  const top = new Set(actual.slice(0, count));
  return projected.slice(0, count).filter((teamKey) => top.has(teamKey)).length;
}
