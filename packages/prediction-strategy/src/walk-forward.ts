/**
 * Walk-forward match prediction from matches already played.
 *
 * Each match is scored from earlier matches only: earlier in the same event,
 * plus events that finished in an earlier phase (divisions before Einstein,
 * both before an October offseason). Divisions that run on the same days do
 * not see each other. Hyperparameters are chosen on the tuning events; the
 * holdout events are not an input to that choice.
 */

import { allianceWinProbability } from "./alliance-outcome";
import { predictAllianceScores, isScorePredictionSkip } from "./calibrated-score";
import { eventOpr, type AllianceResult } from "./event-opr";
import { scoringForSeason } from "./season-scoring";

export type CategoryName = "auto" | "teleop" | "endgame" | "foul";

export const CATEGORY_NAMES = ["auto", "teleop", "endgame", "foul"] as const satisfies readonly CategoryName[];

export type CategoryScores = {
  auto: number | null;
  teleop: number | null;
  endgame: number | null;
  foul: number | null;
  total: number;
};

export type CategorySample = {
  teams: string[];
  auto: number | null;
  teleop: number | null;
  endgame: number | null;
  foul: number | null;
  /** Scoreboard total, fouls included. */
  total: number;
  order: number;
  matchKey?: string;
};

export type ReplayMatch = {
  key: string;
  event: string;
  phase: number;
  order: number;
  level: string;
  qualIndex: number | null;
  qualCount: number;
  red: string[];
  blue: string[];
  redScore: CategoryScores;
  blueScore: CategoryScores;
};

export type ModelKind = "mean" | "vantage" | "plain-opr" | "component-opr" | "epa" | "ensemble";

export type ModelSpec = {
  id: string;
  kind: ModelKind;
  decay: number;
  ridge: number;
  /** In-event pull toward a cross-event prior, in matches. 0 leaves it off. */
  priorK: number;
  epaPrior: number;
  foul: "mean" | "component";
  /** EPA half of an ensemble. Ignored by the other kinds. */
  epaPriorK: number;
  epaFoul: "mean" | "component";
  /** Logistic width as a share of the average scoreboard total. Vantage ignores this and uses its own curve. */
  winShare: number;
  /** Weight on the component-OPR side of an ensemble. The rest is EPA. */
  ensembleWeight: number;
  /**
   * Typical |error| as a share of the average scoreboard total, measured on
   * the holdout. Display only — it is not used to pick the model.
   */
  relativeError: number | null;
};

/** How hard a previous event's rating is pulled toward the mean before it is reused. Stated, not tuned. */
export const PRIOR_MEAN_SHRINK = 4;

/**
 * Tuning events, fixed before any accuracy number was computed.
 * GRITS 2026 is `2026gagr`. The first four division keys in alphabetical order
 * sit with it. The last four divisions and Einstein stay out of this list.
 */
export const TUNING_EVENT_KEYS = ["2026gagr", "2026arc", "2026cur", "2026dal", "2026gal"] as const;

/** Held out in full until the tuning choice was frozen. */
export const HOLDOUT_EVENT_KEYS = ["2026hop", "2026joh", "2026mil", "2026new", "2026cmptx"] as const;

export function phaseForEvent(event: string): number {
  if (event === "2026cmptx") return 1;
  if (event === "2026gagr") return 2;
  return 0;
}

type Rating = {
  matches: number;
  auto: number;
  teleop: number;
  endgame: number;
  foul: number;
};

type SidePrediction = {
  scores: CategoryScores;
  pRed: number;
  picked: "red" | "blue" | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function emptyRating(matches = 0): Rating {
  return { matches, auto: 0, teleop: 0, endgame: 0, foul: 0 };
}

function meanRobot(samples: readonly CategorySample[]): Rating {
  if (!samples.length) return emptyRating();
  const sum = emptyRating(0);
  let counted = 0;
  for (const sample of samples) {
    if (sample.auto == null || sample.teleop == null || sample.endgame == null || sample.foul == null) continue;
    sum.auto += sample.auto;
    sum.teleop += sample.teleop;
    sum.endgame += sample.endgame;
    sum.foul += sample.foul;
    counted += 1;
  }
  if (!counted) return emptyRating();
  return {
    matches: 0,
    auto: sum.auto / counted / 3,
    teleop: sum.teleop / counted / 3,
    endgame: sum.endgame / counted / 3,
    foul: sum.foul / counted / 3,
  };
}

function allianceMean(samples: readonly CategorySample[]): CategoryScores | null {
  const complete = samples.filter(
    (sample) => sample.auto != null && sample.teleop != null && sample.endgame != null && sample.foul != null,
  );
  if (!complete.length) {
    if (!samples.length) return null;
    const total = samples.reduce((sum, sample) => sum + sample.total, 0) / samples.length;
    return { auto: null, teleop: null, endgame: null, foul: null, total };
  }
  const total = (key: CategoryName) => complete.reduce((sum, sample) => sum + (sample[key] ?? 0), 0) / complete.length;
  const auto = total("auto");
  const teleop = total("teleop");
  const endgame = total("endgame");
  const foul = total("foul");
  return { auto, teleop, endgame, foul, total: auto + teleop + endgame + foul };
}

function shrinkRating(past: Rating, mean: Rating, k: number): Rating {
  const weight = past.matches + k;
  if (weight <= 0) return mean;
  return {
    matches: past.matches,
    auto: (past.matches * past.auto + k * mean.auto) / weight,
    teleop: (past.matches * past.teleop + k * mean.teleop) / weight,
    endgame: (past.matches * past.endgame + k * mean.endgame) / weight,
    foul: (past.matches * past.foul + k * mean.foul) / weight,
  };
}

function blendRating(eventRating: Rating | undefined, past: Rating | undefined, mean: Rating, priorK: number): Rating {
  const base = eventRating ?? { ...mean, matches: 0 };
  if (priorK <= 0) return base;
  const prior = past ? shrinkRating(past, mean, PRIOR_MEAN_SHRINK) : mean;
  const matches = base.matches;
  const weight = matches + priorK;
  return {
    matches,
    auto: (matches * base.auto + priorK * prior.auto) / weight,
    teleop: (matches * base.teleop + priorK * prior.teleop) / weight,
    endgame: (matches * base.endgame + priorK * prior.endgame) / weight,
    foul: (matches * base.foul + priorK * prior.foul) / weight,
  };
}

/**
 * One Cholesky factorisation, one right-hand side per category.
 * Same normal equations as `eventOpr`: decay by schedule age, ridge toward the
 * per-robot mean of that category.
 */
function solveCategories(
  samples: readonly CategorySample[],
  decay: number,
  ridge: number,
): Map<string, Rating> | null {
  const complete = samples.filter(
    (sample): sample is CategorySample & { auto: number; teleop: number; endgame: number; foul: number } =>
      sample.auto != null && sample.teleop != null && sample.endgame != null && sample.foul != null,
  );
  if (!complete.length) return null;
  const played = new Map<string, number>();
  for (const sample of complete) for (const team of sample.teams) played.set(team, (played.get(team) ?? 0) + 1);
  const teams = [...played.keys()].sort();
  const index = new Map(teams.map((team, i) => [team, i]));
  const n = teams.length;
  if (!n) return null;
  const orders = [...new Set(complete.map((sample) => sample.order))].sort((a, b) => b - a);
  const age = new Map(orders.map((order, i) => [order, i]));
  const latest = Math.max(...complete.map((sample) => sample.order));
  const cats = CATEGORY_NAMES.length;
  const ata = Array.from({ length: n }, () => new Float64Array(n));
  const atb = Array.from({ length: cats }, () => new Float64Array(n));
  const weightedSum = new Float64Array(cats);
  let weightedSlots = 0;
  for (const sample of complete) {
    const weight = decay ** (age.get(sample.order) ?? latest - sample.order);
    const members = sample.teams.map((team) => index.get(team)).filter((i): i is number => i != null);
    const values = [sample.auto, sample.teleop, sample.endgame, sample.foul];
    for (const i of members) {
      for (let c = 0; c < cats; c += 1) atb[c]![i]! += weight * values[c]!;
      for (const j of members) ata[i]![j]! += weight;
    }
    for (let c = 0; c < cats; c += 1) weightedSum[c]! += weight * values[c]!;
    weightedSlots += weight * Math.max(1, members.length);
  }
  const safeRidge = Math.max(1e-6, ridge);
  for (let i = 0; i < n; i += 1) ata[i]![i]! += safeRidge;
  for (let c = 0; c < cats; c += 1) {
    const prior = weightedSlots > 0 ? weightedSum[c]! / weightedSlots : 0;
    for (let i = 0; i < n; i += 1) atb[c]![i]! += safeRidge * prior;
  }
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
  const columns = CATEGORY_NAMES.map((_, c) => {
    const y = new Float64Array(n);
    const rhs = atb[c]!;
    for (let i = 0; i < n; i += 1) {
      let sum = rhs[i]!;
      for (let k = 0; k < i; k += 1) sum -= l[i]![k]! * y[k]!;
      y[i] = sum / l[i]![i]!;
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i -= 1) {
      let sum = y[i]!;
      for (let k = i + 1; k < n; k += 1) sum -= l[k]![i]! * x[k]!;
      x[i] = sum / l[i]![i]!;
    }
    return x;
  });
  const out = new Map<string, Rating>();
  teams.forEach((team, i) => {
    out.set(team, {
      matches: played.get(team) ?? 0,
      auto: columns[0]![i]!,
      teleop: columns[1]![i]!,
      endgame: columns[2]![i]!,
      foul: columns[3]![i]!,
    });
  });
  return out;
}

function sumRatings(teams: readonly string[], ratings: Map<string, Rating>, fallback: Rating, foulMean: number | null): CategoryScores {
  const total = emptyRating();
  for (const team of teams) {
    const row = ratings.get(team) ?? fallback;
    total.auto += row.auto;
    total.teleop += row.teleop;
    total.endgame += row.endgame;
    total.foul += row.foul;
  }
  const foul = foulMean ?? total.foul;
  return {
    auto: total.auto,
    teleop: total.teleop,
    endgame: total.endgame,
    foul,
    total: total.auto + total.teleop + total.endgame + foul,
  };
}

function winScale(samples: readonly CategorySample[], share: number): number {
  if (!samples.length || !(share > 0)) return 12;
  const mean = samples.reduce((sum, sample) => sum + sample.total, 0) / samples.length;
  return mean > 0 ? share * mean : 12;
}

function componentPredict(
  history: readonly CategorySample[],
  pastRatings: ReadonlyMap<string, Rating>,
  pastSamples: readonly CategorySample[],
  spec: ModelSpec,
  red: readonly string[],
  blue: readonly string[],
): SidePrediction | null {
  if (!history.length && !(spec.priorK > 0 && pastSamples.length)) return null;
  const pool = history.length ? history : pastSamples;
  const solved = history.length ? solveCategories(history, spec.decay, spec.ridge) : null;
  if (history.length && !solved) return null;
  const mean = meanRobot([...pastSamples, ...history]);
  const ratings = new Map<string, Rating>();
  const teams = new Set<string>([...red, ...blue, ...(solved?.keys() ?? [])]);
  for (const team of teams) {
    ratings.set(team, blendRating(solved?.get(team), pastRatings.get(team), mean, spec.priorK));
  }
  const foulMean = spec.foul === "mean" ? (allianceMean(pool)?.foul ?? null) : null;
  const redScores = sumRatings(red, ratings, mean, foulMean);
  const blueScores = sumRatings(blue, ratings, mean, foulMean);
  const scale = winScale(pool, spec.winShare);
  return finish(redScores, blueScores, scale, true);
}

type EpaTeam = Rating & { n: number };

/** First observation of a team, split evenly across the alliance. Used only when there is no prior to predict from. */
function seedEqualShare(
  state: Map<string, EpaTeam>,
  spec: ModelSpec,
  teams: readonly string[],
  observed: CategoryScores,
) {
  if (observed.auto == null || observed.teleop == null || observed.endgame == null || observed.foul == null) return;
  const slots = Math.max(1, teams.length);
  for (const team of teams) {
    if (state.has(team)) continue;
    state.set(team, {
      n: Math.max(1, spec.epaPrior) + 1,
      matches: 1,
      auto: observed.auto / slots,
      teleop: observed.teleop / slots,
      endgame: observed.endgame / slots,
      foul: observed.foul / slots,
    });
  }
}

function epaPredictAndUpdate(
  state: Map<string, EpaTeam>,
  history: readonly CategorySample[],
  pastRatings: ReadonlyMap<string, Rating>,
  pastSamples: readonly CategorySample[],
  spec: ModelSpec,
  red: readonly string[],
  blue: readonly string[],
  actual: { red: CategoryScores; blue: CategoryScores } | null,
): SidePrediction | null {
  const pool = [...pastSamples, ...history];
  if (!pool.length) {
    // The first match has no rating to score against. Its result still has to
    // enter the state, or every later match would ignore that observation.
    if (actual) {
      seedEqualShare(state, spec, red, actual.red);
      seedEqualShare(state, spec, blue, actual.blue);
    }
    return null;
  }
  const mean = meanRobot(pool);
  const read = (team: string): EpaTeam => {
    const existing = state.get(team);
    if (existing) return existing;
    if (spec.priorK > 0 && pastRatings.has(team)) {
      const shrunk = shrinkRating(pastRatings.get(team)!, mean, PRIOR_MEAN_SHRINK);
      return { ...shrunk, matches: 0, n: spec.epaPrior };
    }
    return { ...mean, matches: 0, n: Math.max(1, spec.epaPrior) };
  };
  const project = (teams: readonly string[]) => {
    const acc = emptyRating();
    const before: EpaTeam[] = [];
    for (const team of teams) {
      const row = read(team);
      before.push(row);
      acc.auto += row.auto;
      acc.teleop += row.teleop;
      acc.endgame += row.endgame;
      acc.foul += row.foul;
    }
    return { acc, before };
  };
  const redProj = project(red);
  const blueProj = project(blue);
  const foulMean = spec.foul === "mean" ? (allianceMean(pool)?.foul ?? null) : null;
  const redScores: CategoryScores = {
    auto: redProj.acc.auto,
    teleop: redProj.acc.teleop,
    endgame: redProj.acc.endgame,
    foul: foulMean ?? redProj.acc.foul,
    total: redProj.acc.auto + redProj.acc.teleop + redProj.acc.endgame + (foulMean ?? redProj.acc.foul),
  };
  const blueScores: CategoryScores = {
    auto: blueProj.acc.auto,
    teleop: blueProj.acc.teleop,
    endgame: blueProj.acc.endgame,
    foul: foulMean ?? blueProj.acc.foul,
    total: blueProj.acc.auto + blueProj.acc.teleop + blueProj.acc.endgame + (foulMean ?? blueProj.acc.foul),
  };
  if (actual) {
    const write = (teams: readonly string[], before: EpaTeam[], scores: CategoryScores, observed: CategoryScores) => {
      const residual = {
        auto: (observed.auto ?? scores.auto ?? 0) - (scores.auto ?? 0),
        teleop: (observed.teleop ?? scores.teleop ?? 0) - (scores.teleop ?? 0),
        endgame: (observed.endgame ?? scores.endgame ?? 0) - (scores.endgame ?? 0),
        foul: (observed.foul ?? scores.foul ?? 0) - (scores.foul ?? 0),
      };
      teams.forEach((team, i) => {
        const row = before[i]!;
        const n = row.n;
        state.set(team, {
          n: n + 1,
          matches: row.matches + 1,
          auto: (row.auto * n + row.auto + residual.auto) / (n + 1),
          teleop: (row.teleop * n + row.teleop + residual.teleop) / (n + 1),
          endgame: (row.endgame * n + row.endgame + residual.endgame) / (n + 1),
          foul: (row.foul * n + row.foul + residual.foul) / (n + 1),
        });
      });
    };
    write(red, redProj.before, redScores, actual.red);
    write(blue, blueProj.before, blueScores, actual.blue);
  }
  return finish(redScores, blueScores, winScale(pool, spec.winShare), true);
}

function vantagePredict(history: readonly CategorySample[], spec: ModelSpec, red: readonly string[], blue: readonly string[], matchKey: string): StoredPrediction | null {
  if (!history.length) return null;
  const results: AllianceResult[] = history.map((sample, index) => ({
    matchKey: sample.matchKey ?? `${matchKey}-h${index}`,
    order: sample.order,
    teamKeys: sample.teams,
    total: Math.max(0, sample.total - (sample.foul ?? 0)),
  }));
  const ridge = spec.kind === "plain-opr" ? 0.001 : 0.5;
  const opr = new Map(eventOpr(results, { decay: 1, ridge, minMatches: 1 }).map((row) => [row.teamKey, row.total]));
  const level = results.reduce((sum, row) => sum + row.total, 0) / results.length;
  const meanRobotValue = level / 3;
  const robots = (teams: readonly string[]) =>
    teams.map((teamKey) => ({
      teamKey,
      autoEpa: null,
      teleopEpa: null,
      endgameEpa: null,
      opr: opr.get(teamKey) ?? meanRobotValue,
    }));
  const prediction = predictAllianceScores(
    { matchKey, red: robots(red), blue: robots(blue) },
    { scoringLevel: level },
  );
  if (isScorePredictionSkip(prediction)) return null;
  // The shipped card's win chance, not a second curve. Categories are not what that card predicts.
  const winShare = spec.winShare;
  const scoreboardMean = history.reduce((sum, sample) => sum + sample.total, 0) / history.length;
  const pRed =
    spec.kind === "vantage"
      ? prediction.redWinProbability
      : allianceWinProbability(prediction.redPredicted, prediction.bluePredicted, winShare > 0 ? winShare * scoreboardMean : 12);
  const side = (total: number): CategoryScores => ({ auto: null, teleop: null, endgame: null, foul: null, total });
  const redScores = side(prediction.redPredicted);
  const blueScores = side(prediction.bluePredicted);
  return {
    scores: redScores,
    pRed,
    picked: redScores.total === blueScores.total ? null : redScores.total > blueScores.total ? "red" : "blue",
    red: redScores,
    blue: blueScores,
  };
}

function finish(red: CategoryScores, blue: CategoryScores, scale: number, pick: boolean): SidePrediction & { red: CategoryScores; blue: CategoryScores } {
  const pRed = allianceWinProbability(red.total, blue.total, scale);
  const picked = !pick || red.total === blue.total ? null : red.total > blue.total ? "red" : "blue";
  return { scores: red, pRed, picked, red, blue };
}

type StoredPrediction = SidePrediction & { red: CategoryScores; blue: CategoryScores };

function asStored(value: SidePrediction | (SidePrediction & { red: CategoryScores; blue: CategoryScores }) | null): StoredPrediction | null {
  if (!value) return null;
  if ("red" in value && value.red) return value as StoredPrediction;
  return null;
}

export type ForecastRow = {
  key: string;
  event: string;
  cut: "early" | "mid" | "late";
  winner: "red" | "blue" | "tie";
  pRed: number;
  picked: "red" | "blue" | null;
  red: CategoryScores;
  blue: CategoryScores;
  actualRed: CategoryScores;
  actualBlue: CategoryScores;
};

function cutFor(match: ReplayMatch): ForecastRow["cut"] {
  if (match.level !== "qm" || match.qualIndex == null || match.qualCount <= 0) return "late";
  const third = match.qualCount / 3;
  if (match.qualIndex < third) return "early";
  if (match.qualIndex < third * 2) return "mid";
  return "late";
}

function sampleOf(match: ReplayMatch, side: "red" | "blue"): CategorySample {
  const scores = side === "red" ? match.redScore : match.blueScore;
  return {
    teams: side === "red" ? match.red : match.blue,
    auto: scores.auto,
    teleop: scores.teleop,
    endgame: scores.endgame,
    foul: scores.foul,
    total: scores.total,
    order: match.order,
    matchKey: match.key,
  };
}

function winnerOf(match: ReplayMatch): "red" | "blue" | "tie" {
  if (match.redScore.total > match.blueScore.total) return "red";
  if (match.blueScore.total > match.redScore.total) return "blue";
  return "tie";
}

function endRatings(history: readonly CategorySample[], pastRatings: ReadonlyMap<string, Rating>, pastSamples: readonly CategorySample[], spec: ModelSpec): Map<string, Rating> {
  const solved = solveCategories(history, spec.decay, spec.ridge) ?? new Map<string, Rating>();
  const mean = meanRobot([...pastSamples, ...history]);
  const out = new Map<string, Rating>();
  const teams = new Set<string>([...solved.keys(), ...pastRatings.keys()]);
  for (const team of teams) out.set(team, blendRating(solved.get(team), pastRatings.get(team), mean, spec.priorK));
  return out;
}

function epaEnd(state: Map<string, EpaTeam>): Map<string, Rating> {
  const out = new Map<string, Rating>();
  for (const [team, row] of state) out.set(team, { matches: row.matches, auto: row.auto, teleop: row.teleop, endgame: row.endgame, foul: row.foul });
  return out;
}

/**
 * Predict every scored match from the history the split allows.
 * `historyEvents` may include events that are not scored (so a later holdout
 * final can see divisions that already happened).
 */
export function replaySplit(
  matches: readonly ReplayMatch[],
  spec: ModelSpec,
  scoreEvents: ReadonlySet<string>,
  historyEvents: ReadonlySet<string>,
): ForecastRow[] {
  const byEvent = new Map<string, ReplayMatch[]>();
  for (const match of matches) {
    const list = byEvent.get(match.event);
    if (list) list.push(match);
    else byEvent.set(match.event, [match]);
  }
  for (const list of byEvent.values()) list.sort((a, b) => a.order - b.order);
  const phases = [...new Set(matches.map((match) => match.phase))].sort((a, b) => a - b);
  const finished: {
    phase: number;
    event: string;
    samples: CategorySample[];
    ratings: Map<string, Rating>;
    epaRatings: Map<string, Rating>;
  }[] = [];
  const rows: ForecastRow[] = [];

  for (const phase of phases) {
    const events = [...byEvent.keys()].filter((event) => (byEvent.get(event)?.[0]?.phase ?? 0) === phase).sort();
    const priorSamples = finished.filter((item) => item.phase < phase).flatMap((item) => item.samples);
    const pastRatings = new Map<string, Rating>();
    const pastEpaRatings = new Map<string, Rating>();
    for (const item of finished.filter((row) => row.phase < phase)) {
      for (const [team, rating] of item.ratings) pastRatings.set(team, rating);
      for (const [team, rating] of item.epaRatings) pastEpaRatings.set(team, rating);
    }
    for (const event of events) {
      const list = byEvent.get(event) ?? [];
      const keepHistory = historyEvents.has(event);
      const keepScore = scoreEvents.has(event);
      if (!keepHistory && !keepScore) continue;
      const history: CategorySample[] = [];
      const epa = new Map<string, EpaTeam>();
      for (const match of list) {
        const past = spec.priorK > 0 ? pastRatings : new Map<string, Rating>();
        const pastRows = spec.priorK > 0 || spec.kind === "mean" ? priorSamples : [];
        let predicted: StoredPrediction | null = null;
        if (spec.kind === "mean") {
          const pool = [...pastRows, ...history];
          const mean = allianceMean(pool);
          if (mean) {
            predicted = finish(mean, { ...mean }, 12, false);
            predicted.pRed = 0.5;
            predicted.picked = null;
          }
        } else if (spec.kind === "vantage" || spec.kind === "plain-opr") {
          predicted = asStored(vantagePredict(history, spec, match.red, match.blue, match.key));
        } else if (spec.kind === "component-opr") {
          predicted = asStored(componentPredict(history, past, pastRows, spec, match.red, match.blue));
        } else if (spec.kind === "epa") {
          predicted = asStored(
            epaPredictAndUpdate(epa, history, past, pastRows, spec, match.red, match.blue, {
              red: match.redScore,
              blue: match.blueScore,
            }),
          );
        } else if (spec.kind === "ensemble") {
          const oprSpec = { ...spec, kind: "component-opr" as const };
          const epaSpec = { ...spec, kind: "epa" as const, priorK: spec.epaPriorK, foul: spec.epaFoul };
          const oprPast = spec.priorK > 0 ? pastRatings : new Map<string, Rating>();
          const oprRows = spec.priorK > 0 ? priorSamples : [];
          const epaPast = spec.epaPriorK > 0 ? pastEpaRatings : new Map<string, Rating>();
          const epaRows = spec.epaPriorK > 0 ? priorSamples : [];
          const opr = componentPredict(history, oprPast, oprRows, oprSpec, match.red, match.blue);
          const epaPred = epaPredictAndUpdate(epa, history, epaPast, epaRows, epaSpec, match.red, match.blue, {
            red: match.redScore,
            blue: match.blueScore,
          });
          const storedOpr = asStored(opr);
          const storedEpa = asStored(epaPred);
          if (storedOpr && storedEpa) {
            const mix = (left: CategoryScores, right: CategoryScores): CategoryScores => {
              const weight = spec.ensembleWeight;
              const piece = (a: number | null, b: number | null) =>
                a == null || b == null ? null : weight * a + (1 - weight) * b;
              const auto = piece(left.auto, right.auto);
              const teleop = piece(left.teleop, right.teleop);
              const endgame = piece(left.endgame, right.endgame);
              const foul = piece(left.foul, right.foul);
              return {
                auto,
                teleop,
                endgame,
                foul,
                total: (auto ?? 0) + (teleop ?? 0) + (endgame ?? 0) + (foul ?? 0),
              };
            };
            const redScores = mix(storedOpr.red, storedEpa.red);
            const blueScores = mix(storedOpr.blue, storedEpa.blue);
            const scaleRows = spec.priorK > 0 || spec.epaPriorK > 0 ? [...priorSamples, ...history] : history;
            predicted = finish(redScores, blueScores, winScale(scaleRows, spec.winShare), true);
          }
        } else {
          const unreachable: never = spec.kind;
          throw new Error(`Unknown model kind ${String(unreachable)}`);
        }
        if (keepScore && predicted) {
          rows.push({
            key: match.key,
            event: match.event,
            cut: cutFor(match),
            winner: winnerOf(match),
            pRed: predicted.pRed,
            picked: predicted.picked,
            red: predicted.red,
            blue: predicted.blue,
            actualRed: match.redScore,
            actualBlue: match.blueScore,
          });
        }
        history.push(sampleOf(match, "red"), sampleOf(match, "blue"));
      }
      if (keepHistory) {
        const past = spec.priorK > 0 ? pastRatings : new Map<string, Rating>();
        const pastRows = spec.priorK > 0 ? priorSamples : [];
        const ratings =
          spec.kind === "epa"
            ? epaEnd(epa)
            : spec.kind === "component-opr" || spec.kind === "ensemble"
              ? endRatings(history, past, pastRows, { ...spec, kind: "component-opr" })
              : new Map<string, Rating>();
        const epaRatings = spec.kind === "epa" || spec.kind === "ensemble" ? epaEnd(epa) : new Map<string, Rating>();
        finished.push({ phase, event, samples: history, ratings, epaRatings });
      }
    }
  }
  return rows;
}

export type CutName = "all" | "early" | "mid" | "late";

export type CutMetrics = {
  alliances: number;
  matches: number;
  decided: number;
  picks: number;
  mae: Record<CategoryName | "total", number | null>;
  rmse: Record<CategoryName | "total", number | null>;
  winnerAccuracy: number | null;
  brier: number | null;
  logLoss: number | null;
};

export type CalibrationBin = { label: string; n: number; predicted: number; actual: number };

export type MetricsBundle = {
  byCut: Record<CutName, CutMetrics>;
  calibration: CalibrationBin[];
};

function blankCut(): { abs: Record<CategoryName | "total", number[]>; matches: number; decided: number; picks: number; correct: number; brier: number; logLoss: number } {
  return {
    abs: { auto: [], teleop: [], endgame: [], foul: [], total: [] },
    matches: 0,
    decided: 0,
    picks: 0,
    correct: 0,
    brier: 0,
    logLoss: 0,
  };
}

function finishCut(state: ReturnType<typeof blankCut>): CutMetrics {
  const summarise = (values: number[]) => {
    if (!values.length) return { mae: null, rmse: null };
    const mae = values.reduce((sum, value) => sum + value, 0) / values.length;
    const rmse = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    return { mae: round2(mae), rmse: round2(rmse) };
  };
  const mae = {} as CutMetrics["mae"];
  const rmse = {} as CutMetrics["rmse"];
  for (const key of ["auto", "teleop", "endgame", "foul", "total"] as const) {
    const summary = summarise(state.abs[key]);
    mae[key] = summary.mae;
    rmse[key] = summary.rmse;
  }
  return {
    alliances: state.abs.total.length,
    matches: state.matches,
    decided: state.decided,
    picks: state.picks,
    mae,
    rmse,
    winnerAccuracy: state.picks ? round3(state.correct / state.picks) : null,
    brier: state.decided ? round3(state.brier / state.decided) : null,
    logLoss: state.decided ? round3(state.logLoss / state.decided) : null,
  };
}

export function metricsOf(rows: readonly ForecastRow[]): MetricsBundle {
  const buckets: Record<CutName, ReturnType<typeof blankCut>> = {
    all: blankCut(),
    early: blankCut(),
    mid: blankCut(),
    late: blankCut(),
  };
  const bins = [0, 0.2, 0.4, 0.6, 0.8, 1].map((low, index, edges) => ({
    low,
    high: edges[index + 1] ?? 1,
    n: 0,
    predicted: 0,
    actual: 0,
  }));
  for (const row of rows) {
    const targets: CutName[] = ["all", row.cut];
    for (const cut of targets) {
      const state = buckets[cut];
      state.matches += 1;
      for (const side of ["red", "blue"] as const) {
        const predicted = side === "red" ? row.red : row.blue;
        const actual = side === "red" ? row.actualRed : row.actualBlue;
        for (const key of ["auto", "teleop", "endgame", "foul", "total"] as const) {
          const left = predicted[key];
          const right = actual[key];
          if (left == null || right == null) continue;
          state.abs[key].push(Math.abs(left - right));
        }
      }
      if (row.winner === "tie") continue;
      state.decided += 1;
      const p = Math.min(0.98, Math.max(0.02, row.pRed));
      const won = row.winner === "red";
      state.brier += (p - (won ? 1 : 0)) ** 2;
      state.logLoss += won ? -Math.log(p) : -Math.log(1 - p);
      if (row.picked) {
        state.picks += 1;
        if (row.picked === row.winner) state.correct += 1;
      }
      if (cut === "all") {
        const bin = bins.find((item, index) => row.pRed >= item.low && (row.pRed < item.high || index === bins.length - 1));
        if (bin) {
          bin.n += 1;
          bin.predicted += row.pRed;
          bin.actual += won ? 1 : 0;
        }
      }
    }
  }
  return {
    byCut: {
      all: finishCut(buckets.all),
      early: finishCut(buckets.early),
      mid: finishCut(buckets.mid),
      late: finishCut(buckets.late),
    },
    calibration: bins
      .filter((bin) => bin.n > 0)
      .map((bin) => ({
        label: `${Math.round(bin.low * 100)}–${Math.round(bin.high * 100)}%`,
        n: bin.n,
        predicted: round3(bin.predicted / bin.n),
        actual: round3(bin.actual / bin.n),
      })),
  };
}

const tuningSet = () => new Set<string>(TUNING_EVENT_KEYS);
const holdoutSet = () => new Set<string>(HOLDOUT_EVENT_KEYS);
const allEvents = (matches: readonly ReplayMatch[]) => new Set(matches.map((match) => match.event));

export function replayTuning(matches: readonly ReplayMatch[], spec: ModelSpec): ForecastRow[] {
  return replaySplit(matches, spec, tuningSet(), tuningSet());
}

export function replayHoldout(matches: readonly ReplayMatch[], spec: ModelSpec): ForecastRow[] {
  return replaySplit(matches, spec, holdoutSet(), allEvents(matches));
}

function better(next: MetricsBundle, best: MetricsBundle | null): boolean {
  if (!best) return true;
  const mae = next.byCut.all.mae.total ?? Number.POSITIVE_INFINITY;
  const bestMae = best.byCut.all.mae.total ?? Number.POSITIVE_INFINITY;
  if (mae < bestMae - 0.005) return true;
  if (mae > bestMae + 0.005) return false;
  const accuracy = next.byCut.all.winnerAccuracy ?? -1;
  const bestAccuracy = best.byCut.all.winnerAccuracy ?? -1;
  if (accuracy > bestAccuracy + 0.0005) return true;
  if (accuracy < bestAccuracy - 0.0005) return false;
  return (next.byCut.all.brier ?? 1) < (best.byCut.all.brier ?? 1) - 0.0005;
}

function specId(spec: Omit<ModelSpec, "id" | "relativeError"> & { id?: string }): string {
  return [
    spec.kind,
    `d${spec.decay}`,
    `r${spec.ridge}`,
    `k${spec.priorK}`,
    spec.foul,
    `ek${spec.epaPriorK}`,
    spec.epaFoul,
    `e${spec.epaPrior}`,
    `w${spec.ensembleWeight}`,
    `s${spec.winShare}`,
  ].join("-");
}

export type ModelCandidate = {
  role: "component-opr" | "epa" | "ensemble" | "winner";
  spec: ModelSpec;
  tuning: MetricsBundle;
};

/**
 * Pick a spec using tuning matches only.
 * Score error is minimised first. Win-curve width is chosen after that, by Brier score.
 * The holdout is not read here.
 */
export function chooseCategoryModel(matches: readonly ReplayMatch[]): {
  spec: ModelSpec;
  tuning: MetricsBundle;
  candidates: ModelCandidate[];
} {
  const decays = [1, 0.93, 0.85];
  const ridges = [0.5, 2, 8];
  const priorKs = [0, 4, 10];
  const fouls = ["mean", "component"] as const;
  let bestSpec: ModelSpec | null = null;
  let bestMetrics: MetricsBundle | null = null;

  const consider = (partial: Omit<ModelSpec, "id" | "relativeError">) => {
    const spec: ModelSpec = { ...partial, id: specId(partial), relativeError: null };
    const metrics = metricsOf(replayTuning(matches, spec));
    if (better(metrics, bestMetrics)) {
      bestSpec = spec;
      bestMetrics = metrics;
    }
    return metrics;
  };

  let bestOpr: ModelSpec | null = null;
  let bestOprMetrics: MetricsBundle | null = null;
  for (const decay of decays) {
    for (const ridge of ridges) {
      for (const priorK of priorKs) {
        for (const foul of fouls) {
          const spec: ModelSpec = {
            id: "",
            kind: "component-opr",
            decay,
            ridge,
            priorK,
            epaPrior: 4,
            foul,
            epaPriorK: 0,
            epaFoul: foul,
            winShare: 0.3,
            ensembleWeight: 1,
            relativeError: null,
          };
          spec.id = specId(spec);
          const metrics = metricsOf(replayTuning(matches, spec));
          if (better(metrics, bestOprMetrics)) {
            bestOpr = spec;
            bestOprMetrics = metrics;
          }
        }
      }
    }
  }

  let bestEpa: ModelSpec | null = null;
  let bestEpaMetrics: MetricsBundle | null = null;
  for (const epaPrior of [2, 6, 12]) {
    for (const priorK of priorKs) {
      for (const foul of fouls) {
        const spec: ModelSpec = {
          id: "",
          kind: "epa",
          decay: 1,
          ridge: 0.5,
          priorK,
          epaPrior,
          foul,
          epaPriorK: priorK,
          epaFoul: foul,
          winShare: 0.3,
          ensembleWeight: 0,
          relativeError: null,
        };
        spec.id = specId(spec);
        const metrics = metricsOf(replayTuning(matches, spec));
        if (better(metrics, bestEpaMetrics)) {
          bestEpa = spec;
          bestEpaMetrics = metrics;
        }
      }
    }
  }

  if (bestOpr) consider(bestOpr);
  if (bestEpa) consider(bestEpa);
  let bestEnsemble: ModelSpec | null = null;
  let bestEnsembleMetrics: MetricsBundle | null = null;
  if (bestOpr && bestEpa) {
    for (const ensembleWeight of [0.35, 0.5, 0.65]) {
      const partial = {
        kind: "ensemble" as const,
        decay: bestOpr.decay,
        ridge: bestOpr.ridge,
        priorK: bestOpr.priorK,
        epaPrior: bestEpa.epaPrior,
        epaPriorK: bestEpa.priorK,
        foul: bestOpr.foul,
        epaFoul: bestEpa.foul,
        winShare: 0.3,
        ensembleWeight,
      };
      const metrics = consider(partial);
      const spec: ModelSpec = { ...partial, id: specId(partial), relativeError: null };
      if (better(metrics, bestEnsembleMetrics)) {
        bestEnsemble = spec;
        bestEnsembleMetrics = metrics;
      }
    }
  }

  const pickedSpec = bestSpec;
  const pickedMetrics = bestMetrics;
  const oprSpec = bestOpr;
  const oprMetrics = bestOprMetrics;
  const epaSpecPicked = bestEpa;
  const epaMetrics = bestEpaMetrics;
  if (!pickedSpec || !pickedMetrics || !oprSpec || !oprMetrics || !epaSpecPicked || !epaMetrics) {
    throw new Error("No model could be scored on the tuning set");
  }
  const candidates: ModelCandidate[] = [
    { role: "component-opr", spec: oprSpec, tuning: oprMetrics },
    { role: "epa", spec: epaSpecPicked, tuning: epaMetrics },
  ];
  if (bestEnsemble && bestEnsembleMetrics) {
    candidates.push({ role: "ensemble", spec: bestEnsemble, tuning: bestEnsembleMetrics });
  }
  let chosen: ModelSpec = pickedSpec;
  let chosenMetrics: MetricsBundle = pickedMetrics;
  for (const winShare of [0.15, 0.2, 0.3, 0.45, 0.6, 0.8]) {
    const spec: ModelSpec = { ...chosen, winShare, id: specId({ ...chosen, winShare }) };
    const metrics = metricsOf(replayTuning(matches, spec));
    const brier = metrics.byCut.all.brier ?? 1;
    const bestBrier = chosenMetrics.byCut.all.brier ?? 1;
    if (brier < bestBrier - 0.0005) {
      chosen = spec;
      chosenMetrics = metrics;
    }
  }
  candidates.push({ role: "winner", spec: chosen, tuning: chosenMetrics });
  return { spec: chosen, tuning: chosenMetrics, candidates };
}

export type MatchForecast = {
  modelId: string;
  red: CategoryScores;
  blue: CategoryScores;
  redWinProbability: number;
  errorBand: number | null;
  redBand: number | null;
  blueBand: number | null;
  confidence: string;
  categoriesKnown: boolean;
};

export type MatchForecastSkip = { skipReason: string };

export function isMatchForecastSkip(value: MatchForecast | MatchForecastSkip): value is MatchForecastSkip {
  return "skipReason" in value;
}

function playedCount(samples: readonly CategorySample[], team: string): number {
  let count = 0;
  for (const sample of samples) if (sample.teams.includes(team)) count += 1;
  return count;
}

function clampSide(side: CategoryScores): CategoryScores {
  const piece = (value: number | null) => (value == null ? null : Math.max(0, Math.round(value * 10) / 10));
  const auto = piece(side.auto);
  const teleop = piece(side.teleop);
  const endgame = piece(side.endgame);
  const foul = piece(side.foul);
  const total =
    auto != null && teleop != null && endgame != null && foul != null
      ? Math.round((auto + teleop + endgame + foul) * 10) / 10
      : Math.max(0, Math.round(side.total * 10) / 10);
  return { auto, teleop, endgame, foul, total };
}

function scoresFromSample(sample: CategorySample): CategoryScores {
  return { auto: sample.auto, teleop: sample.teleop, endgame: sample.endgame, foul: sample.foul, total: sample.total };
}

/**
 * Walk played alliance rows in order and leave the EPA state where the
 * backtest would be before the next match. Pairs share a match key.
 */
function replayEpaState(
  played: readonly CategorySample[],
  spec: ModelSpec,
  pastRatings: ReadonlyMap<string, Rating>,
  pastSamples: readonly CategorySample[],
): Map<string, EpaTeam> {
  const state = new Map<string, EpaTeam>();
  const groups = new Map<string, CategorySample[]>();
  const keys: string[] = [];
  played.forEach((sample, index) => {
    const key = sample.matchKey ?? `single:${sample.order}:${index}`;
    const existing = groups.get(key);
    if (existing) existing.push(sample);
    else {
      groups.set(key, [sample]);
      keys.push(key);
    }
  });
  const history: CategorySample[] = [];
  for (const key of keys) {
    const sides = groups.get(key) ?? [];
    const redSide = sides[0];
    const blueSide = sides[1];
    if (redSide && blueSide && sides.length === 2) {
      epaPredictAndUpdate(state, history, pastRatings, pastSamples, spec, redSide.teams, blueSide.teams, {
        red: scoresFromSample(redSide),
        blue: scoresFromSample(blueSide),
      });
    }
    history.push(...sides);
  }
  return state;
}

function bandFor(base: number | null, samples: readonly CategorySample[], teams: readonly string[]): number | null {
  if (base == null) return null;
  const counts = teams.map((team) => playedCount(samples, team));
  const avg = counts.reduce((sum, value) => sum + value, 0) / Math.max(1, counts.length);
  // Stated widening: a robot with few matches has a less settled mean. Not fitted.
  const widen = avg >= 4 ? 1 : Math.sqrt(4 / Math.max(1, avg));
  return Math.max(1, Math.round(base * Math.min(2, widen)));
}

/**
 * Predict one upcoming match from samples that have already been played.
 * The caller is responsible for leaving out the match itself and anything after it.
 */
export function forecastMatch(input: {
  season: number;
  red: string[];
  blue: string[];
  played: readonly CategorySample[];
  spec?: ModelSpec;
}): MatchForecast | MatchForecastSkip {
  const scoring = scoringForSeason(input.season);
  const spec = input.spec ?? SHIPPED_CATEGORY_MODEL;
  const played = input.played.filter((sample) => sample.teams.length > 0 && Number.isFinite(sample.total));
  const redKnown = input.red.filter((team) => playedCount(played, team) > 0).length;
  const blueKnown = input.blue.filter((team) => playedCount(played, team) > 0).length;
  if (!played.length || redKnown < 2 || blueKnown < 2) {
    return { skipReason: "Not enough of these robots have played yet to estimate this match." };
  }
  const complete = played.filter(
    (sample) => sample.auto != null && sample.teleop != null && sample.endgame != null && sample.foul != null,
  );
  // One match missing a breakdown must not throw the rest away, and a handful
  // of breakdowns must not invent a split the event did not record.
  const categoriesKnown = scoring.categoriesKnown && complete.length >= 8 && complete.length * 2 >= played.length;
  const history = categoriesKnown ? complete : played;
  const effective: ModelSpec = categoriesKnown ? spec : { ...spec, kind: spec.kind === "mean" ? "mean" : "vantage", priorK: 0 };
  const upcomingKey = "upcoming";
  let predicted: StoredPrediction | null = null;
  if (!categoriesKnown || effective.kind === "vantage" || effective.kind === "plain-opr") {
    predicted = asStored(vantagePredict(played, { ...effective, kind: "vantage" }, input.red, input.blue, upcomingKey));
  } else if (effective.kind === "component-opr") {
    predicted = asStored(componentPredict(history, new Map(), [], effective, input.red, input.blue));
  } else if (effective.kind === "epa") {
    const state = replayEpaState(history, effective, new Map(), []);
    predicted = asStored(epaPredictAndUpdate(state, history, new Map(), [], effective, input.red, input.blue, null));
  } else if (effective.kind === "ensemble") {
    const epaSpec: ModelSpec = { ...effective, kind: "epa", priorK: effective.epaPriorK, foul: effective.epaFoul };
    const opr = asStored(componentPredict(history, new Map(), [], { ...effective, kind: "component-opr" }, input.red, input.blue));
    const state = replayEpaState(history, epaSpec, new Map(), []);
    const epaPred = asStored(epaPredictAndUpdate(state, history, new Map(), [], epaSpec, input.red, input.blue, null));
    if (opr && epaPred) {
      const weight = effective.ensembleWeight;
      const mix = (left: CategoryScores, right: CategoryScores): CategoryScores => {
        const piece = (a: number | null, b: number | null) => (a == null || b == null ? null : weight * a + (1 - weight) * b);
        const auto = piece(left.auto, right.auto);
        const teleop = piece(left.teleop, right.teleop);
        const endgame = piece(left.endgame, right.endgame);
        const foul = piece(left.foul, right.foul);
        return { auto, teleop, endgame, foul, total: (auto ?? 0) + (teleop ?? 0) + (endgame ?? 0) + (foul ?? 0) };
      };
      predicted = finish(mix(opr.red, epaPred.red), mix(opr.blue, epaPred.blue), winScale(history, effective.winShare), true);
    }
  } else if (effective.kind === "mean") {
    const mean = allianceMean(history);
    if (mean) predicted = { ...finish(mean, { ...mean }, 12, false), pRed: 0.5, picked: null };
  } else {
    const unreachable: never = effective.kind;
    throw new Error(`Unknown model kind ${String(unreachable)}`);
  }
  if (!predicted) return { skipReason: "Not enough of these robots have played yet to estimate this match." };
  const red = clampSide(categoriesKnown ? predicted.red : { ...predicted.red, auto: null, teleop: null, endgame: null, foul: null });
  const blue = clampSide(categoriesKnown ? predicted.blue : { ...predicted.blue, auto: null, teleop: null, endgame: null, foul: null });
  const scale = winScale(played, categoriesKnown && effective.kind !== "vantage" ? effective.winShare : 0.3);
  const pRed = categoriesKnown && effective.kind !== "vantage"
    ? allianceWinProbability(red.total, blue.total, scale)
    : predicted.pRed;
  const meanTotal = played.reduce((sum, sample) => sum + sample.total, 0) / played.length;
  const errorBand =
    played.length >= 8 && spec.relativeError != null && spec.relativeError > 0
      ? Math.max(1, Math.round(meanTotal * spec.relativeError))
      : null;
  const margin = Math.round(red.total - blue.total);
  const bandBit = errorBand == null ? "" : ` Typical miss ±${errorBand}.`;
  const categoryBit = categoriesKnown ? "" : " Scoring categories for this season are not published yet, so this is a total only.";
  const confidence =
    margin === 0
      ? `Even match.${bandBit}${categoryBit}`
      : `${margin > 0 ? "Red" : "Blue"} by ${Math.abs(margin)} points.${bandBit}${categoryBit}`;
  return {
    modelId: spec.id,
    red,
    blue,
    redWinProbability: Math.round(Math.min(0.98, Math.max(0.02, pRed)) * 1000) / 1000,
    errorBand,
    redBand: bandFor(errorBand, played, input.red),
    blueBand: bandFor(errorBand, played, input.blue),
    confidence: confidence.trim(),
    categoriesKnown,
  };
}

/**
 * Filled after `chooseCategoryModel` on the tuning events. The holdout is not
 * an input to these fields except `relativeError`, which is the holdout's
 * typical miss and is only used as the ± on screen.
 */
export const SHIPPED_CATEGORY_MODEL: ModelSpec = {
  id: "component-opr-d1-r2-k0-mean-ek0-mean-e4-w1-s0.2",
  kind: "component-opr",
  decay: 1,
  ridge: 2,
  priorK: 0,
  epaPrior: 4,
  foul: "mean",
  epaPriorK: 0,
  epaFoul: "mean",
  winShare: 0.2,
  ensembleWeight: 1,
  /**
   * Holdout total MAE 94.53 / mean scoreboard 445.7, rounded to 3 decimals.
   * Display only. It was not an input to the model choice.
   */
  relativeError: 0.212,
};
