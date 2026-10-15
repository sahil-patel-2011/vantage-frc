/**
 * How a team's seasons have gone, in words a pit crew can use: are they better than most teams
 * year after year, climbing, or slipping. Each season is read against that year's whole field
 * (season-scale.ts), so different games compare fairly.
 *
 * Nothing is invented: a team with one season of results gets that one fact, and a team with none
 * gets no lines at all.
 */

import { normalShareBelow, seasonScaleMap, seasonZ, type SeasonScale } from "./season-scale";
import { MAX_SEASONS_COUNTED } from "./season-weight";

export type SeasonPoint = { year: number; epa: number; matches?: number | null };

export type SeasonStanding = {
  year: number;
  /** Share of that year's teams this team was better than, 0–100. */
  betterThan: number;
};

export type TeamTrend = {
  direction: "rising" | "steady" | "falling" | "new" | "unknown";
  /** Change in `betterThan` per season, fitted over the recent seasons (positive = climbing). */
  slopePerSeason: number | null;
  standings: SeasonStanding[];
  /** Plain sentences, most useful first. Empty when there is nothing real to say. */
  lines: string[];
};

/** Points of "better than" per season that count as a real climb or slide, not noise. */
const TREND_THRESHOLD = 6;
const RECENT = 5;

function ordinalShare(value: number): string {
  return `${Math.round(value)}%`;
}

/** Least-squares slope of y over x, weighted toward recent seasons. */
function weightedSlope(points: Array<{ x: number; y: number; w: number }>): number | null {
  const total = points.reduce((sum, p) => sum + p.w, 0);
  if (points.length < 3 || total <= 0) return null;
  const mx = points.reduce((sum, p) => sum + p.w * p.x, 0) / total;
  const my = points.reduce((sum, p) => sum + p.w * p.y, 0) / total;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += p.w * (p.x - mx) * (p.y - my);
    den += p.w * (p.x - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}

export function teamTrend(
  points: readonly SeasonPoint[],
  scales: readonly SeasonScale[] | Map<number, SeasonScale>,
  currentYear: number,
  teamLabel = "This team",
): TeamTrend {
  const map = scales instanceof Map ? scales : seasonScaleMap(scales);
  const standings: SeasonStanding[] = points
    .filter((p) => Number.isFinite(p.epa) && p.year <= currentYear && currentYear - p.year < MAX_SEASONS_COUNTED)
    .filter((p) => p.matches == null || p.matches > 0)
    .flatMap((p) => {
      const scale = map.get(p.year);
      return scale ? [{ year: p.year, betterThan: Math.round(normalShareBelow(seasonZ(p.epa, scale)) * 1000) / 10 }] : [];
    })
    .sort((a, b) => a.year - b.year);

  if (!standings.length) return { direction: "unknown", slopePerSeason: null, standings, lines: [] };

  const latest = standings.at(-1)!;
  if (standings.length === 1) {
    return {
      direction: "new",
      slopePerSeason: null,
      standings,
      lines: [`${teamLabel} was better than ${ordinalShare(latest.betterThan)} of teams in ${latest.year}, its only season with results here.`],
    };
  }

  const recent = standings.slice(-RECENT);
  const slope = weightedSlope(recent.map((s) => ({ x: s.year, y: s.betterThan, w: 0.55 ** (latest.year - s.year) })));
  const direction: TeamTrend["direction"] =
    slope == null ? "steady" : slope >= TREND_THRESHOLD ? "rising" : slope <= -TREND_THRESHOLD ? "falling" : "steady";

  const lines: string[] = [];
  const elite = recent.filter((s) => s.betterThan >= 90).length;
  const strong = recent.filter((s) => s.betterThan >= 75).length;
  const span = `${recent[0]!.year}–${latest.year}`;
  if (elite >= 3) lines.push(`${teamLabel} has been in the top 10% of teams in ${elite} of its last ${recent.length} seasons (${span}).`);
  else if (strong >= 3) lines.push(`${teamLabel} has been in the top quarter of teams in ${strong} of its last ${recent.length} seasons (${span}).`);

  const first = recent[0]!;
  if (direction === "rising") {
    lines.push(`${teamLabel} is climbing: better than ${ordinalShare(first.betterThan)} of teams in ${first.year}, ${ordinalShare(latest.betterThan)} in ${latest.year}.`);
  } else if (direction === "falling") {
    lines.push(`${teamLabel} has slipped: better than ${ordinalShare(first.betterThan)} of teams in ${first.year}, ${ordinalShare(latest.betterThan)} in ${latest.year}.`);
  } else if (!lines.length) {
    const average = recent.reduce((sum, s) => sum + s.betterThan, 0) / recent.length;
    lines.push(`${teamLabel} has been steady, usually better than about ${ordinalShare(average)} of teams (${span}).`);
  }

  const best = standings.reduce((top, s) => (s.betterThan > top.betterThan ? s : top), standings[0]!);
  if (best.year !== latest.year && best.betterThan - latest.betterThan >= 15) {
    lines.push(`Its best recent season was ${best.year} (better than ${ordinalShare(best.betterThan)} of teams).`);
  }

  return { direction, slopePerSeason: slope == null ? null : Math.round(slope * 10) / 10, standings, lines };
}
