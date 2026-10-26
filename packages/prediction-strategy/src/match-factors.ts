/**
 * Extra signals on top of the category score model.
 *
 * Every factor defaults off. A season prior uses public event ratings that
 * finished before the match, never a full-event rating of a match still being
 * predicted. Win-chance calibration is fit only on earlier matches, and
 * parallel divisions do not train each other. Range widths are chosen on the
 * tuning rows; this file does not read a holdout.
 */

import { normalCdf } from "./score-uncertainty";

/** Stated pull of a prior toward the current mean, in matches. Same value as the score model. */
const PRIOR_MEAN_SHRINK = 4;

/**
 * First day of each study event, from the public event pages fetched 2026-10-26.
 * A prior event counts only when its last day is strictly before this date.
 */
export const STUDY_EVENT_START: Readonly<Record<string, string>> = {
  "2026arc": "2026-04-29",
  "2026cur": "2026-04-29",
  "2026dal": "2026-04-29",
  "2026gal": "2026-04-29",
  "2026hop": "2026-04-29",
  "2026joh": "2026-04-29",
  "2026mil": "2026-04-29",
  "2026new": "2026-04-29",
  "2026cmptx": "2026-05-02",
  "2026gagr": "2026-10-16",
};

export type StrengthEvent = {
  key: string;
  year: number;
  start: string;
  end: string;
};

export type StrengthRating = {
  event: string;
  team: string;
  matches: number;
  opr: number;
  qualMatches?: number;
  qualOpr: number | null;
  playoffMatches?: number;
  playoffOpr: number | null;
};

export type TeamSeasonPrior = {
  sameWeight: number;
  samePoints: number;
  zWeight: number;
  z: number;
  playoffWeight: number;
  playoffDelta: number;
};

export type YearScale = { mean: number; sd: number; weight: number };

const CURRENT_GAME_YEAR = 2026;

/** Match-weighted mean and spread of a year's per-robot totals. Other years are not on the 2026 point scale. */
export function yearScales(events: readonly StrengthEvent[], ratings: readonly StrengthRating[]): Map<number, YearScale> {
  const yearOf = new Map(events.map((event) => [event.key, event.year]));
  const acc = new Map<number, { weight: number; sum: number; sumSq: number }>();
  for (const rating of ratings) {
    const year = yearOf.get(rating.event);
    if (year == null || !(rating.matches > 0) || !Number.isFinite(rating.opr)) continue;
    const row = acc.get(year) ?? { weight: 0, sum: 0, sumSq: 0 };
    row.weight += rating.matches;
    row.sum += rating.matches * rating.opr;
    row.sumSq += rating.matches * rating.opr * rating.opr;
    acc.set(year, row);
  }
  const out = new Map<number, YearScale>();
  for (const [year, row] of acc) {
    if (!(row.weight > 0)) continue;
    const mean = row.sum / row.weight;
    const variance = Math.max(0, row.sumSq / row.weight - mean * mean);
    out.set(year, { mean, sd: Math.sqrt(variance), weight: row.weight });
  }
  return out;
}

/**
 * One prior per robot per study event.
 * 2026 ratings stay in points. Older seasons become z-scores against that year's robots.
 * `seasonDecay` weights a year by seasonDecay^(2026-year).
 */
/**
 * One event's prior. A rating counts only when that event's last day is before
 * `start`. The event being predicted is never a prior for itself.
 */
export function seasonPriorForEvent(input: {
  events: readonly StrengthEvent[];
  ratings: readonly StrengthRating[];
  eventKey: string;
  start: string;
  seasonDecay: number;
  blockedEvents?: ReadonlySet<string>;
}): Map<string, TeamSeasonPrior> {
  const decay = input.seasonDecay > 0 ? input.seasonDecay : 1;
  const blocked = input.blockedEvents ?? new Set<string>();
  const eventByKey = new Map(input.events.map((event) => [event.key, event]));
  const scales = yearScales(input.events, input.ratings);
  type Acc = {
    sameWeight: number;
    sameSum: number;
    zWeight: number;
    zSum: number;
    playoffWeight: number;
    playoffSum: number;
  };
  const empty = (): Acc => ({ sameWeight: 0, sameSum: 0, zWeight: 0, zSum: 0, playoffWeight: 0, playoffSum: 0 });
  const teams = new Map<string, Acc>();
  for (const rating of input.ratings) {
    const event = eventByKey.get(rating.event);
    if (!event || event.key === input.eventKey || blocked.has(event.key)) continue;
    if (!(event.end < input.start)) continue;
    if (!(rating.matches > 0) || !Number.isFinite(rating.opr)) continue;
    const yearGap = CURRENT_GAME_YEAR - event.year;
    const weight = rating.matches * decay ** Math.max(0, yearGap);
    if (!(weight > 0)) continue;
    const acc = teams.get(rating.team) ?? empty();
    if (event.year === CURRENT_GAME_YEAR) {
      acc.sameWeight += weight;
      acc.sameSum += weight * rating.opr;
      const qual = rating.qualOpr;
      const playoff = rating.playoffOpr;
      const qualMatches = rating.qualMatches ?? 0;
      const playoffMatches = rating.playoffMatches ?? 0;
      if (qual != null && playoff != null && qualMatches >= 3 && playoffMatches >= 2) {
        const playoffWeight = playoffMatches * decay ** Math.max(0, yearGap);
        acc.playoffWeight += playoffWeight;
        acc.playoffSum += playoffWeight * (playoff - qual);
      }
    } else {
      const scale = scales.get(event.year);
      if (scale && scale.sd > 1) {
        acc.zWeight += weight;
        acc.zSum += weight * ((rating.opr - scale.mean) / scale.sd);
      }
    }
    teams.set(rating.team, acc);
  }
  const priors = new Map<string, TeamSeasonPrior>();
  for (const [team, acc] of teams) {
    if (!(acc.sameWeight > 0) && !(acc.zWeight > 0)) continue;
    priors.set(team, {
      sameWeight: acc.sameWeight,
      samePoints: acc.sameWeight > 0 ? acc.sameSum / acc.sameWeight : 0,
      zWeight: acc.zWeight,
      z: acc.zWeight > 0 ? acc.zSum / acc.zWeight : 0,
      playoffWeight: acc.playoffWeight,
      playoffDelta: acc.playoffWeight > 0 ? acc.playoffSum / acc.playoffWeight : 0,
    });
  }
  return priors;
}

export function seasonPriorsForStudy(input: {
  events: readonly StrengthEvent[];
  ratings: readonly StrengthRating[];
  studyEvents?: readonly string[];
  blockedEvents?: ReadonlySet<string>;
  seasonDecay: number;
}): Map<string, Map<string, TeamSeasonPrior>> {
  const study = input.studyEvents ?? Object.keys(STUDY_EVENT_START);
  const out = new Map<string, Map<string, TeamSeasonPrior>>();
  for (const studyEvent of study) {
    const start = STUDY_EVENT_START[studyEvent];
    if (!start) continue;
    out.set(
      studyEvent,
      seasonPriorForEvent({
        events: input.events,
        ratings: input.ratings,
        eventKey: studyEvent,
        start,
        seasonDecay: input.seasonDecay,
        blockedEvents: input.blockedEvents,
      }),
    );
  }
  return out;
}

/**
 * Map a prior onto the current event's point scale and shrink it toward the
 * current mean. Older-season z-scores need a current spread; without one they
 * are left out rather than treated as 2026 points.
 */
export function seasonPoints(
  prior: TeamSeasonPrior,
  currentMean: number,
  currentSd: number,
  shrink = PRIOR_MEAN_SHRINK,
): { points: number; weight: number } | null {
  let weight = 0;
  let acc = 0;
  if (prior.sameWeight > 0 && Number.isFinite(prior.samePoints)) {
    weight += prior.sameWeight;
    acc += prior.sameWeight * prior.samePoints;
  }
  if (prior.zWeight > 0 && currentSd > 1 && Number.isFinite(prior.z) && Number.isFinite(currentMean)) {
    weight += prior.zWeight;
    acc += prior.zWeight * (currentMean + prior.z * currentSd);
  }
  if (!(weight > 0)) return null;
  const raw = acc / weight;
  const anchor = currentMean > 0 ? currentMean : raw;
  const pull = shrink > 0 ? shrink : 0;
  const points = (weight * raw + pull * anchor) / (weight + pull);
  return { points, weight };
}

export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0.02) return 0.02;
  if (value > 0.98) return 0.98;
  return value;
}

/** Win chance from a normal margin. Sigma is a share of the scoreboard mean already played. */
export function normalWinProbability(margin: number, sigma: number): number {
  if (!(sigma > 0) || !Number.isFinite(margin)) return 0.5;
  return clampProbability(normalCdf(margin / sigma));
}

type SideTotals = {
  total: number;
  auto: number | null;
  teleop: number | null;
  endgame: number | null;
  foul: number | null;
};

export type ProbabilityRow = {
  event: string;
  phase?: number;
  order?: number;
  pRed: number;
  winner: "red" | "blue" | "tie";
  red: SideTotals;
  blue: SideTotals;
  historyMean?: number;
};

export function withNormalMargin<T extends ProbabilityRow>(rows: readonly T[], share: number): T[] {
  return rows.map((row) => {
    const mean = row.historyMean ?? 0;
    const sigma = share > 0 && mean > 0 ? share * mean : 0;
    if (!(sigma > 0)) return row;
    return { ...row, pRed: normalWinProbability(row.red.total - row.blue.total, sigma) };
  });
}

function logit(p: number): number {
  const clamped = Math.min(0.98, Math.max(0.02, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(value: number): number {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
}

type FitPoint = { p: number; y: number };

function plattMap(points: readonly FitPoint[]): (p: number) => number {
  let bestA = 0;
  let bestB = 1;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let a = -1.5; a <= 1.5 + 1e-9; a += 0.25) {
    for (let b = 0; b <= 2 + 1e-9; b += 0.25) {
      let loss = 0;
      for (const point of points) {
        const p = clampProbability(sigmoid(a + b * logit(point.p)));
        loss += point.y ? -Math.log(p) : -Math.log(1 - p);
      }
      const mean = loss / points.length;
      if (mean < bestLoss - 1e-9) {
        bestLoss = mean;
        bestA = a;
        bestB = b;
      }
    }
  }
  return (p: number) => clampProbability(sigmoid(bestA + bestB * logit(p)));
}

function isotonicMap(points: readonly FitPoint[]): (p: number) => number {
  const sorted = [...points].sort((left, right) => left.p - right.p);
  const blocks: { sum: number; count: number; lo: number; hi: number }[] = [];
  for (const point of sorted) {
    blocks.push({ sum: point.y, count: 1, lo: point.p, hi: point.p });
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1]!;
      const prev = blocks[blocks.length - 2]!;
      if (prev.sum / prev.count <= last.sum / last.count + 1e-12) break;
      blocks.pop();
      blocks.pop();
      blocks.push({
        sum: prev.sum + last.sum,
        count: prev.count + last.count,
        lo: prev.lo,
        hi: last.hi,
      });
    }
  }
  const fitted = blocks.map((block) => ({
    lo: block.lo,
    hi: block.hi,
    rate: clampProbability(block.sum / block.count),
  }));
  return (p: number) => {
    if (!fitted.length) return clampProbability(p);
    if (p <= fitted[0]!.lo) return fitted[0]!.rate;
    const last = fitted[fitted.length - 1]!;
    if (p >= last.hi) return last.rate;
    for (let i = 0; i < fitted.length; i += 1) {
      const block = fitted[i]!;
      if (p <= block.hi) return block.rate;
      const next = fitted[i + 1];
      if (next && p < next.lo) {
        const span = next.lo - block.hi;
        const t = span > 0 ? (p - block.hi) / span : 0;
        return clampProbability(block.rate + t * (next.rate - block.rate));
      }
    }
    return last.rate;
  };
}

function earlierMatch(train: ProbabilityRow, row: ProbabilityRow): boolean {
  if (train.event === row.event) return (train.order ?? 0) < (row.order ?? 0);
  return (train.phase ?? 0) < (row.phase ?? 0);
}

const MIN_CALIBRATION_MATCHES = 40;

/**
 * Fit Platt or isotonic on earlier matches only. Same-phase events (parallel
 * divisions) are not earlier. Fewer than 40 earlier decided matches keeps the
 * raw probability. The winner pick is not on this row and is not changed.
 */
export function walkForwardCalibrate<T extends ProbabilityRow>(rows: readonly T[], method: "raw" | "platt" | "isotonic"): T[] {
  if (method === "raw") return rows.map((row) => ({ ...row }));
  return rows.map((row, index) => {
    if (row.winner === "tie") return row;
    const points: FitPoint[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (i === index) continue;
      const train = rows[i]!;
      if (train.winner === "tie" || !earlierMatch(train, row)) continue;
      points.push({ p: train.pRed, y: train.winner === "red" ? 1 : 0 });
    }
    if (points.length < MIN_CALIBRATION_MATCHES) return row;
    const map = method === "platt" ? plattMap(points) : isotonicMap(points);
    return { ...row, pRed: map(row.pRed) };
  });
}

export function brierScore(rows: readonly ProbabilityRow[]): number | null {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    if (row.winner === "tie") continue;
    const p = clampProbability(row.pRed);
    const y = row.winner === "red" ? 1 : 0;
    total += (p - y) ** 2;
    count += 1;
  }
  return count ? total / count : null;
}

export type ProbabilityChoice = {
  share: number | null;
  method: "logistic" | "normal" | "platt" | "isotonic";
  brier: number;
};

const MARGIN_SHARES = [0.15, 0.2, 0.3, 0.45, 0.6, 0.8] as const;

/**
 * Pick a win curve on these rows only. Normal width is chosen first. Platt and
 * isotonic are then fit walk-forward on that curve. The lowest Brier wins.
 */
/** Reapply a frozen probability choice. Does not look for a better one. */
export function applyProbability<T extends ProbabilityRow>(rows: readonly T[], choice: ProbabilityChoice): T[] {
  const base = choice.share == null ? rows.map((row) => ({ ...row })) : withNormalMargin(rows, choice.share);
  if (choice.method === "platt" || choice.method === "isotonic") return walkForwardCalibrate(base, choice.method);
  return base;
}

export function chooseProbability(rows: readonly ProbabilityRow[]): ProbabilityChoice & { rows: ProbabilityRow[] } {
  const logistic = brierScore(rows) ?? 1;
  let best: ProbabilityChoice & { rows: ProbabilityRow[] } = {
    share: null,
    method: "logistic",
    brier: logistic,
    rows: rows.map((row) => ({ ...row })),
  };
  for (const share of MARGIN_SHARES) {
    const normalRows = withNormalMargin(rows, share);
    const normalBrier = brierScore(normalRows) ?? 1;
    if (normalBrier < best.brier - 0.0005) {
      best = { share, method: "normal", brier: normalBrier, rows: normalRows };
    }
    for (const method of ["platt", "isotonic"] as const) {
      const calibrated = walkForwardCalibrate(normalRows, method);
      const calibratedBrier = brierScore(calibrated) ?? 1;
      if (calibratedBrier < best.brier - 0.0005) {
        best = { share, method, brier: calibratedBrier, rows: calibrated };
      }
    }
  }
  return best;
}

export type RangeCategory = "auto" | "teleop" | "endgame" | "foul" | "total" | "margin";

export type RangeFit = {
  category: RangeCategory;
  k: number;
  nRef: number;
  z90: number;
  /** Split-conformal level. Absent on the older empirical-quantile fit. */
  level?: number;
  tuningCoverage: number;
  tuningMeanWidth: number;
};

export type RangeRow = ProbabilityRow & {
  actualRed: SideTotals;
  actualBlue: SideTotals;
  redExperience?: number;
  blueExperience?: number;
};

const RANGE_KS = [1, 4, 8, 1000] as const;

function median(values: number[]): number {
  if (!values.length) return 8;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 8;
}

function quantile90(sorted: number[]): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.9 * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function widen(n: number, nRef: number, k: number): number {
  return Math.sqrt((nRef + k) / (Math.max(0, n) + k));
}

type Residual = { abs: number; n: number; event?: string };

function residualsOf(rows: readonly RangeRow[], category: RangeCategory): Residual[] {
  const out: Residual[] = [];
  for (const row of rows) {
    if (category === "margin") {
      const predicted = row.red.total - row.blue.total;
      const actual = row.actualRed.total - row.actualBlue.total;
      const n = ((row.redExperience ?? 0) + (row.blueExperience ?? 0)) / 2;
      out.push({ abs: Math.abs(actual - predicted), n });
      continue;
    }
    const sides = [
      { predicted: row.red[category], actual: row.actualRed[category], n: row.redExperience ?? 0 },
      { predicted: row.blue[category], actual: row.actualBlue[category], n: row.blueExperience ?? 0 },
    ];
    for (const side of sides) {
      if (side.predicted == null || side.actual == null) continue;
      out.push({ abs: Math.abs(side.actual - side.predicted), n: side.n });
    }
  }
  return out;
}

function coverageOf(residuals: readonly Residual[], nRef: number, k: number, z90: number): { coverage: number; meanWidth: number } {
  if (!residuals.length) return { coverage: 0, meanWidth: 0 };
  let inside = 0;
  let width = 0;
  for (const residual of residuals) {
    const half = z90 * widen(residual.n, nRef, k);
    width += half * 2;
    if (residual.abs <= half + 1e-6) inside += 1;
  }
  return { coverage: inside / residuals.length, meanWidth: width / residuals.length };
}

/**
 * Split conformal quantile. Rank is ceil((n+1)*level), 1-based, so a finite
 * sample is slightly wider than the raw 90th percentile. Returns null when
 * that rank is past the last residual (the interval would be unbounded).
 */
function conformalQuantile(sorted: readonly number[], level: number): number | null {
  const n = sorted.length;
  if (!n) return null;
  const rank = Math.ceil((n + 1) * level);
  if (rank < 1 || rank > n) return null;
  return sorted[rank - 1] ?? null;
}

function taggedResiduals(rows: readonly RangeRow[], category: RangeCategory): Residual[] {
  const out: Residual[] = [];
  for (const row of rows) {
    if (category === "margin") {
      const predicted = row.red.total - row.blue.total;
      const actual = row.actualRed.total - row.actualBlue.total;
      const n = ((row.redExperience ?? 0) + (row.blueExperience ?? 0)) / 2;
      out.push({ abs: Math.abs(actual - predicted), n, event: row.event });
      continue;
    }
    const sides = [
      { predicted: row.red[category], actual: row.actualRed[category], n: row.redExperience ?? 0 },
      { predicted: row.blue[category], actual: row.actualBlue[category], n: row.blueExperience ?? 0 },
    ];
    for (const side of sides) {
      if (side.predicted == null || side.actual == null) continue;
      out.push({ abs: Math.abs(side.actual - side.predicted), n: side.n, event: row.event });
    }
  }
  return out;
}

/**
 * Split conformal interval from calibration rows only.
 *
 * The level starts at 0.90. It rises by 0.01, up to 0.99, until every
 * left-out calibration event is covered at least 90% of the time. k is then
 * the widen setting with the narrowest of those intervals. The test rows are
 * not an argument, so they cannot choose the width.
 */
export function fitSplitConformal(rows: readonly RangeRow[], category: RangeCategory): RangeFit {
  const tagged = taggedResiduals(rows, category);
  const nRef = median(tagged.map((residual) => residual.n));
  const events = [...new Set(tagged.map((residual) => residual.event))];
  let best: { k: number; level: number; width: number } | null = null;
  for (const k of RANGE_KS) {
    const scored = tagged.map((residual) => ({ ...residual, z: residual.abs / widen(residual.n, nRef, k) }));
    for (let step = 0; step <= 9; step += 1) {
      const level = Math.round((0.9 + step * 0.01) * 100) / 100;
      let width = 0;
      let count = 0;
      let minCoverage = 1;
      let scoredEvents = 0;
      for (const event of events) {
        const others = scored.filter((residual) => residual.event !== event).map((residual) => residual.z).sort((a, b) => a - b);
        const left = scored.filter((residual) => residual.event === event);
        const quantile = conformalQuantile(others, level);
        if (quantile == null || !left.length) continue;
        scoredEvents += 1;
        let inside = 0;
        for (const residual of left) {
          count += 1;
          const half = quantile * widen(residual.n, nRef, k);
          width += half * 2;
          if (residual.abs <= half + 1e-9) inside += 1;
        }
        const coverage = inside / left.length;
        if (coverage < minCoverage) minCoverage = coverage;
      }
      if (!scoredEvents || minCoverage + 1e-12 < 0.9) continue;
      const meanWidth = count ? width / count : Number.POSITIVE_INFINITY;
      if (!best || level < best.level - 1e-9 || (Math.abs(level - best.level) < 1e-9 && meanWidth < best.width)) {
        best = { k, level, width: meanWidth };
      }
      break;
    }
  }
  const chosen = best ?? { k: 8, level: 0.9, width: 0 };
  const scores = tagged.map((residual) => residual.abs / widen(residual.n, nRef, chosen.k)).sort((a, b) => a - b);
  const z90 = conformalQuantile(scores, chosen.level) ?? 0;
  const scored = coverageOf(tagged, nRef, chosen.k, z90);
  return {
    category,
    k: chosen.k,
    nRef,
    z90,
    level: chosen.level,
    tuningCoverage: scored.coverage,
    tuningMeanWidth: scored.meanWidth,
  };
}

/** 90% residual quantile on these rows, widened when the robots have few matches. k is chosen here. */
export function fitRange(rows: readonly RangeRow[], category: RangeCategory): RangeFit {
  const residuals = residualsOf(rows, category);
  const nRef = median(residuals.map((residual) => residual.n));
  let best: RangeFit | null = null;
  for (const k of RANGE_KS) {
    const zs = residuals.map((residual) => residual.abs / widen(residual.n, nRef, k)).sort((a, b) => a - b);
    const z90 = quantile90(zs);
    const scored = coverageOf(residuals, nRef, k, z90);
    const fit: RangeFit = {
      category,
      k,
      nRef,
      z90,
      tuningCoverage: scored.coverage,
      tuningMeanWidth: scored.meanWidth,
    };
    if (!best) {
      best = fit;
      continue;
    }
    const gap = Math.abs(fit.tuningCoverage - 0.9);
    const bestGap = Math.abs(best.tuningCoverage - 0.9);
    if (gap < bestGap - 1e-6 || (Math.abs(gap - bestGap) <= 1e-6 && fit.tuningMeanWidth < best.tuningMeanWidth)) {
      best = fit;
    }
  }
  return (
    best ?? {
      category,
      k: 8,
      nRef,
      z90: 0,
      tuningCoverage: 0,
      tuningMeanWidth: 0,
    }
  );
}

export function measureRange(rows: readonly RangeRow[], fit: RangeFit): { n: number; coverage: number; meanWidth: number } {
  const residuals = residualsOf(rows, fit.category);
  const scored = coverageOf(residuals, fit.nRef, fit.k, fit.z90);
  return { n: residuals.length, coverage: scored.coverage, meanWidth: scored.meanWidth };
}

/** Half-width of a frozen 90% interval. n is the mean matches already played by that alliance. */
export function rangeHalfWidth(n: number, fit: Pick<RangeFit, "k" | "nRef" | "z90">): number {
  if (!(fit.z90 > 0)) return 0;
  return fit.z90 * widen(n, fit.nRef, fit.k);
}

/** Holdout coverage in this band is what "the range held" means. Widths are not refit after that. */
export function rangeHeld(coverage: number): boolean {
  return coverage >= 0.85 && coverage <= 0.95;
}

export function expectedAccuracy(rows: readonly ProbabilityRow[]): { n: number; ceiling: number | null; accuracy: number | null } {
  let ceiling = 0;
  let correct = 0;
  let n = 0;
  for (const row of rows) {
    if (row.winner === "tie") continue;
    const p = clampProbability(row.pRed);
    ceiling += Math.max(p, 1 - p);
    const picked = p >= 0.5 ? "red" : "blue";
    if (picked === row.winner) correct += 1;
    n += 1;
  }
  if (!n) return { n: 0, ceiling: null, accuracy: null };
  return { n, ceiling: ceiling / n, accuracy: correct / n };
}

/** Accuracy among decided matches whose win chance is at least `minProbability` on the picked side. */
export function confidenceTier(rows: readonly ProbabilityRow[], minProbability: number): { n: number; accuracy: number | null } {
  let correct = 0;
  let n = 0;
  for (const row of rows) {
    if (row.winner === "tie") continue;
    const p = clampProbability(row.pRed);
    const confidence = Math.max(p, 1 - p);
    if (confidence < minProbability) continue;
    const picked = p >= 0.5 ? "red" : "blue";
    n += 1;
    if (picked === row.winner) correct += 1;
  }
  return { n, accuracy: n ? correct / n : null };
}
