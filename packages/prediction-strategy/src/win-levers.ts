/**
 * What would actually move a predicted result.
 *
 * A win probability on its own is a weather report. The question a drive team
 * asks in the pit is the next one: what do we change between now and the match?
 *
 * Every lever here is derived by re-running the real rating engine with one
 * measured input changed, then re-reading the same win curve the prediction
 * came from. Nothing is a rule of thumb and nothing is invented: a lever exists
 * only when the quantity behind it has actually been measured for this team. A
 * team with no recorded fouls gets no "stop fouling" advice, because we do not
 * know that they foul.
 *
 * The two ceiling levers (penalties, reliability) are labelled as ceilings, not
 * forecasts. "Zero penalties" is the arithmetic limit of a thing you control,
 * which is a useful upper bound and an honest one, as long as nobody reads it
 * as a promise.
 */

import { allianceWinProbability, rateTeam } from "./alliance-outcome";
import { strategyEnginePolicyForId, type StrategyEnginePolicy } from "./engine-tier";
import type {
  StrategyEngineId,
  TeamOperationalSignal,
  TeamSeasonSignal,
} from "./types";

export type LeverId =
  | "penalties"
  | "reliability"
  | "defend-top-opponent"
  | "scoring-rate";

export type WinLever = {
  id: LeverId;
  /** Imperative, pit-side phrasing. */
  title: string;
  /** What was measured, and what the lever assumes changes. */
  detail: string;
  /** Points of alliance rating this adds (0 for the exchange-rate lever). */
  ratingGain: number;
  /** Win probability once applied, 0–1. */
  probabilityAfter: number;
  /** Percentage points gained, e.g. 4.2. */
  gain: number;
  /** True when the lever is the arithmetic limit of the input, not a forecast. */
  isCeiling: boolean;
};

/**
 * Gains smaller than this are not worth an afternoon of pit time, and are far
 * inside the model's own confidence interval besides.
 */
export const MIN_LEVER_GAIN_PP = 0.5;

/** A team is worth defending only if it is carrying a real share of its alliance. */
export const DEFENCE_SHARE_FLOOR = 0.34;

/** Defence is modelled as holding a robot to this share of its usual output. */
export const DEFENCE_SUPPRESSION = 0.5;

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
const pp = (before: number, after: number) => round1((after - before) * 100);

function shortTeam(teamKey: string) {
  return teamKey.replace(/^frc/i, "");
}

export type WinLeverInput = {
  /** The team asking. Must be on `ourAlliance`. */
  teamKey: string;
  currentYear: number;
  seasons: TeamSeasonSignal[];
  /** Measured operational signal for our team; absent means no ceiling levers. */
  operational?: TeamOperationalSignal;
  /** Summed rating of our other two robots. */
  partnerRating: number;
  /** Opponent robots, with the ratings the prediction already computed. */
  opponents: Array<{ teamKey: string; rating: number }>;
  engineId?: StrategyEngineId;
};

/**
 * Ranked levers for one alliance in one match, best first.
 *
 * Returns an empty list rather than filler when nothing is measurable — an
 * empty state says "we have not scouted this yet", which is true and
 * actionable. A list of generic advice would say nothing and look like data.
 */
export function winLevers(input: WinLeverInput): WinLever[] {
  const policy: StrategyEnginePolicy = strategyEnginePolicyForId(
    input.engineId ?? "weighted-current-v1",
  );
  const rateWith = (operational?: TeamOperationalSignal) =>
    rateTeam(input.teamKey, input.currentYear, input.seasons, operational, policy).rating;

  const baseRating = rateWith(input.operational);
  const opponentTotal = input.opponents.reduce((total, row) => total + row.rating, 0);
  const ourTotal = input.partnerRating + baseRating;

  // With no ratings on either side the win curve reads a flat 50/50, and every
  // lever below would be measuring movement away from a number that means
  // nothing. Say so instead.
  if (ourTotal <= 0 && opponentTotal <= 0) return [];

  const before = allianceWinProbability(ourTotal, opponentTotal);

  const levers: WinLever[] = [];
  const measured = input.operational;

  // Penalties. The engine subtracts a foul penalty straight off the rating, so
  // the ceiling is exactly that penalty handed back.
  if (measured && (measured.foulRate ?? 0) > 0) {
    const clean = rateWith({ ...measured, foulRate: 0 });
    const after = allianceWinProbability(input.partnerRating + clean, opponentTotal);
    levers.push({
      id: "penalties",
      title: "Play a clean match",
      detail: `Scouting has you at ${round2(measured.foulRate ?? 0)} penalty points per match. Drawing none is worth ${round1(clean - baseRating)} points of alliance rating.`,
      ratingGain: round1(clean - baseRating),
      probabilityAfter: after,
      gain: pp(before, after),
      isCeiling: true,
    });
  }

  // Reliability. A robot that does not finish its matches is rated down toward
  // the share of its output the engine can actually count on.
  if (measured && measured.reliability != null && measured.reliability < 100) {
    const sound = rateWith({ ...measured, reliability: 100 });
    const after = allianceWinProbability(input.partnerRating + sound, opponentTotal);
    levers.push({
      id: "reliability",
      title: "Finish every match",
      detail: `You have finished ${Math.round(measured.reliability)}% of scouted matches. Fixing whatever ends the other ${Math.round(100 - measured.reliability)}% is worth ${round1(sound - baseRating)} points.`,
      ratingGain: round1(sound - baseRating),
      probabilityAfter: after,
      gain: pp(before, after),
      isCeiling: true,
    });
  }

  // Defence. Worth naming only when one opponent is genuinely carrying; playing
  // defence on an even alliance mostly costs you your own output.
  const strongest = [...input.opponents].sort((a, b) => b.rating - a.rating)[0];
  if (strongest && opponentTotal > 0 && strongest.rating / opponentTotal >= DEFENCE_SHARE_FLOOR) {
    const suppressed = opponentTotal - strongest.rating * (1 - DEFENCE_SUPPRESSION);
    const after = allianceWinProbability(ourTotal, suppressed);
    levers.push({
      id: "defend-top-opponent",
      title: `Defend ${shortTeam(strongest.teamKey)}`,
      detail: `${shortTeam(strongest.teamKey)} is ${Math.round((strongest.rating / opponentTotal) * 100)}% of the opposing alliance. Holding them to half their usual output swings this match more than anything you can add on your side.`,
      ratingGain: 0,
      probabilityAfter: after,
      gain: pp(before, after),
      isCeiling: false,
    });
  }

  const ranked = levers
    .filter((lever) => lever.gain >= MIN_LEVER_GAIN_PP)
    .sort((a, b) => b.gain - a.gain);

  // The exchange rate is always true and never a ceiling, so it goes last as
  // context for anything the drive team is considering that we cannot measure.
  const tenMore = allianceWinProbability(ourTotal + 10, opponentTotal);
  ranked.push({
    id: "scoring-rate",
    title: "What ten more points is worth",
    detail: `At this margin, ten extra alliance points moves your odds by ${pp(before, tenMore)} points. Use it to price anything you are weighing that scouting has not measured yet.`,
    ratingGain: 10,
    probabilityAfter: tenMore,
    gain: pp(before, tenMore),
    isCeiling: false,
  });

  return ranked;
}

/** One line for the empty state, so it explains itself rather than apologising. */
export const NO_LEVERS_COPY =
  "Nothing measurable to change yet. Levers appear once this team has scouted matches behind it — penalties and reliability come from your own scouting, not from public data.";
