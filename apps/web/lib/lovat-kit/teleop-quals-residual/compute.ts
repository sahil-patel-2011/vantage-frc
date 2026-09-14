/**
 * Lovat-style Teleop board — qualification matches, opponent-adjusted.
 * Missing samples stay blank. Nothing here invents a rating.
 */

export const SLUG = "teleop-quals-residual";
export const PHASE_LABEL = "Teleop";
export const WINDOW_LABEL = "qualification matches";
export const KERNEL_LABEL = "opponent-adjusted";
export const WINDOW_N: number | null = null;
export const QUALS_ONLY = true;
export const PLAYOFFS_ONLY = false;
export const EWMA_ALPHA = 0.647;
export const TRIM_FRACTION = 0.232;
export const NEAR_Z = 0.385;
export const ROBOT_RADIUS_IN = 17.0;
export const FIELD_W_IN = 1654;
export const FIELD_H_IN = 811;

export type LovatMetricId = "teleopPoints" | "teleopFuel" | "cycles" | "scoringRate";

export type LovatMetricDef = {
  id: LovatMetricId;
  label: string;
  invert: boolean;
};

export const METRICS: readonly LovatMetricDef[] = [
  {
    "id": "teleopPoints",
    "label": "Teleop points",
    "invert": false
  },
  {
    "id": "teleopFuel",
    "label": "Teleop fuel",
    "invert": false
  },
  {
    "id": "cycles",
    "label": "Cycles",
    "invert": false
  },
  {
    "id": "scoringRate",
    "label": "Scoring rate",
    "invert": false
  }
] as const;

export type SampleRow = {
  teamKey: string;
  matchKey?: string;
  qual?: boolean;
  values: Partial<Record<LovatMetricId, number | null | undefined>>;
  path?: PathPoint[];
  actions?: TimelineAction[];
};

export type PathPoint = { t: number; x: number; y: number };
export type TimelineAction = { t: number; key: string; value?: number | null };
export type FieldStat = { mean: number; std: number; n: number };
export type CompareTone = "above" | "near" | "below" | "unknown";
export type FieldCompare = { tone: CompareTone; label: string; delta: number | null; z: number | null };

export type MetricCard = {
  id: LovatMetricId;
  label: string;
  value: number | null;
  display: string;
  compare: FieldCompare;
  contribution: number | null;
  sparkline: string | null;
  sample: number;
  detail: string;
};

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function uniqueTeamKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^frc\d+[a-z]?$/i.test(trimmed)) return `frc${trimmed.slice(3)}`;
  if (/^\d+[a-z]?$/i.test(trimmed)) return `frc${trimmed}`;
  return null;
}

export function populationMean(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function populationStdDev(values: readonly number[]): number | null {
  const mean = populationMean(values);
  if (mean == null || values.length === 0) return null;
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  return Math.sqrt(variance);
}

export function zScore(value: number | null, mean: number | null, std: number | null): number | null {
  if (value == null || mean == null || std == null || !Number.isFinite(std) || std <= 0) return null;
  return (value - mean) / std;
}

export function percentile(values: readonly number[], p: number): number | null {
  const clean = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const t = clamp(p, 0, 1) * (clean.length - 1);
  const lo = Math.floor(t);
  const hi = Math.ceil(t);
  const a = clean[lo];
  const b = clean[hi];
  if (a == null || b == null) return null;
  return a + (b - a) * (t - lo);
}

export function iqr(values: readonly number[]): number | null {
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  if (q1 == null || q3 == null) return null;
  return q3 - q1;
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}

export function trimmedMean(values: readonly number[], fraction = TRIM_FRACTION): number | null {
  const clean = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const drop = Math.floor(clean.length * clamp(fraction, 0, 0.4));
  const kept = clean.slice(drop, clean.length - drop || clean.length);
  return populationMean(kept.length ? kept : clean);
}

export function winsorize(values: readonly number[], fraction = TRIM_FRACTION): number[] {
  const clean = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (clean.length === 0) return [];
  const lo = percentile(clean, fraction);
  const hi = percentile(clean, 1 - fraction);
  if (lo == null || hi == null) return clean;
  return clean.map((value) => clamp(value, lo, hi));
}

export function ewmaSeries(values: readonly number[], alpha = EWMA_ALPHA): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  let current = clean[0]!;
  for (let i = 1; i < clean.length; i += 1) {
    current = alpha * clean[i]! + (1 - alpha) * current;
  }
  return current;
}

export function coefficientOfVariation(values: readonly number[]): number | null {
  const mean = populationMean(values);
  const std = populationStdDev(values);
  if (mean == null || std == null || mean === 0) return null;
  return Math.abs(std / mean);
}

export function consistencyScore(values: readonly number[]): number | null {
  const cv = coefficientOfVariation(values);
  if (cv == null) return null;
  return clamp(1 - cv, 0, 1);
}

export function rollingMean(values: readonly number[], window: number): Array<number | null> {
  const size = Math.max(1, Math.trunc(window));
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - size + 1), index + 1).filter((value) => Number.isFinite(value));
    return populationMean(slice);
  });
}

export function jackknifeMean(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return populationMean(clean);
  const parts: number[] = [];
  for (let i = 0; i < clean.length; i += 1) {
    const leave = clean.filter((_, index) => index !== i);
    const mean = populationMean(leave);
    if (mean != null) parts.push(mean);
  }
  return populationMean(parts);
}

export function formatValue(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

export function fieldCompare(value: number | null, mean: number | null, std: number | null, invert = false): FieldCompare {
  if (value == null || mean == null || !Number.isFinite(value) || !Number.isFinite(mean)) {
    return { tone: "unknown", label: "Need two teams at this event", delta: null, z: null };
  }
  const delta = invert ? mean - value : value - mean;
  const z = zScore(invert ? mean : value, invert ? value : mean, std);
  const magnitude = z != null ? Math.abs(z) : Math.abs(delta) / Math.max(1, Math.abs(mean));
  if (magnitude < NEAR_Z) return { tone: "near", label: "Near this event", delta, z };
  if (delta > 0) return { tone: "above", label: "Above this event", delta, z };
  return { tone: "below", label: "Below this event", delta, z };
}

export function contributionShare(value: number | null, mean: number | null): number | null {
  if (value == null || mean == null || !Number.isFinite(value) || !Number.isFinite(mean) || mean === 0) return null;
  return Math.round((value / mean) * 1000) / 1000;
}

export function sparklinePath(values: Array<number | null | undefined>, width = 72, height = 28): string | null {
  const points = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const step = width / (points.length - 1);
  return points
    .map((value, index) => {
      const x = index * step;
      const y = span === 0 ? height / 2 : height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function windowRows(rows: readonly SampleRow[]): SampleRow[] {
  let next = rows.filter((row) => uniqueTeamKey(row.teamKey));
  if (QUALS_ONLY) next = next.filter((row) => row.qual !== false);
  if (PLAYOFFS_ONLY) next = next.filter((row) => row.qual === false);
  if (WINDOW_N != null) next = next.slice(-WINDOW_N);
  return next;
}

export function valuesFor(rows: readonly SampleRow[], id: LovatMetricId): number[] {
  return windowRows(rows)
    .map((row) => asNumber(row.values[id]))
    .filter((value): value is number => value != null);
}

export function fieldStats(rows: readonly SampleRow[]): Partial<Record<LovatMetricId, FieldStat>> {
  const stats: Partial<Record<LovatMetricId, FieldStat>> = {};
  for (const metric of METRICS) {
    const values = valuesFor(rows, metric.id);
    const mean = populationMean(values);
    const std = populationStdDev(values);
    if (mean == null || std == null) continue;
    stats[metric.id] = { mean, std, n: values.length };
  }
  return stats;
}

export function teamValue(rows: readonly SampleRow[], teamKey: string, id: LovatMetricId): number | null {
  const mine = windowRows(rows).filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey));
  const values = mine.map((row) => asNumber(row.values[id])).filter((value): value is number => value != null);
  if (values.length === 0) return null;
  switch ("residual") {
    case "ewma":
      return ewmaSeries(values);
    case "trimmed":
      return trimmedMean(values);
    case "consistency":
      return consistencyScore(values);
    case "rate":
      return populationMean(values);
    case "rank":
      return populationMean(values);
    case "shrink":
      return ewmaSeries(values);
    case "streak":
      return streakValue(values);
    case "hazard":
      return reliabilityHazard(values);
    case "residual":
    case "zone":
    case "pareto":
    case "brier":
    case "trueskill":
    case "colley":
    case "draft":
      return populationMean(values);
    default:
      return populationMean(values);
  }
}

export function denseRank(value: number | null, field: readonly number[], invert = false): number | null {
  if (value == null) return null;
  const ordered = field.filter((item) => Number.isFinite(item)).slice().sort((a, b) => (invert ? a - b : b - a));
  const index = ordered.findIndex((item) => item === value);
  return index < 0 ? null : index + 1;
}

export function pathLength(points: readonly PathPoint[]): number | null {
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export function pathDuration(points: readonly PathPoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dt = last.t - first.t;
  return dt > 0 ? dt : null;
}

export function interpolatePath(points: readonly PathPoint[], t: number): PathPoint | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0]!;
  const lo = points[0]!;
  const hi = points[points.length - 1]!;
  if (t <= lo.t) return lo;
  if (t >= hi.t) return hi;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      const u = span === 0 ? 0 : (t - a.t) / span;
      return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  return hi;
}

export function robotsOverlap(a: PathPoint, b: PathPoint, radius = ROBOT_RADIUS_IN): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < radius * 2;
}

export function interferenceWindows(
  paths: readonly (readonly PathPoint[])[],
  step = 0.2,
): Array<{ t: number; pair: [number, number] }> {
  const hits: Array<{ t: number; pair: [number, number] }> = [];
  const usable = paths.filter((path) => path.length >= 2);
  if (usable.length < 2) return hits;
  const start = Math.min(...usable.map((path) => path[0]!.t));
  const end = Math.max(...usable.map((path) => path[path.length - 1]!.t));
  if (!(end > start)) return hits;
  for (let t = start; t <= end + 1e-9; t += step) {
    const samples = usable.map((path) => interpolatePath(path, t));
    for (let i = 0; i < samples.length; i += 1) {
      for (let j = i + 1; j < samples.length; j += 1) {
        const left = samples[i];
        const right = samples[j];
        if (left && right && robotsOverlap(left, right)) hits.push({ t: Math.round(t * 100) / 100, pair: [i, j] });
      }
    }
  }
  return hits;
}

export function occupancy(actions: readonly TimelineAction[], key: string, matchSeconds = 150): number | null {
  const hits = actions.filter((action) => action.key === key && Number.isFinite(action.t));
  if (hits.length === 0) return null;
  const span = clamp(matchSeconds, 1, 200);
  return clamp(hits.length / span, 0, 1);
}

export function allianceSum(rows: readonly SampleRow[], teamKeys: readonly string[], id: LovatMetricId): number | null {
  const parts = teamKeys.map((teamKey) => teamValue(rows, teamKey, id));
  if (parts.some((part) => part == null)) return null;
  return parts.reduce((sum, part) => sum + (part ?? 0), 0);
}

export function complementarity(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = populationMean(values);
  const std = populationStdDev(values);
  if (mean == null || std == null || mean === 0) return null;
  return clamp(1 - std / Math.abs(mean), 0, 1);
}

export function buildCards(input: {
  teamKey: string;
  rows: readonly SampleRow[];
  fieldRows?: readonly SampleRow[];
}): MetricCard[] {
  const field = fieldStats(input.fieldRows ?? input.rows);
  return METRICS.map((metric) => {
    const value = teamValue(input.rows, input.teamKey, metric.id);
    const stat = field[metric.id];
    const series = windowRows(input.rows)
      .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(input.teamKey))
      .map((row) => asNumber(row.values[metric.id]));
    const compare = fieldCompare(value, stat?.mean ?? null, stat?.std ?? null, metric.invert);
    return {
      id: metric.id,
      label: metric.label,
      value,
      display: formatValue(value),
      compare,
      contribution: metric.invert ? null : contributionShare(value, stat?.mean ?? null),
      sparkline: sparklinePath(series),
      sample: series.filter((item) => item != null).length,
      detail:
        value == null
          ? "Needs setup — no scout rows yet"
          : `${PHASE_LABEL} · ${WINDOW_LABEL} · ${KERNEL_LABEL}`,
    };
  });
}

export function emptyCopy(): { badge: string; title: string; description: string } {
  return {
    badge: "Needs setup",
    title: `No ${PHASE_LABEL.toLowerCase()} numbers yet`,
    description: `This board stays blank until real ${WINDOW_LABEL} samples exist. Compared to this event uses the whole field — never a filled-in zero.`,
  };
}

export function readyHeadline(teamKey: string, cards: MetricCard[]): string {
  const known = cards.filter((card) => card.value != null).length;
  const team = uniqueTeamKey(teamKey) ?? teamKey;
  return known === 0
    ? `${team} · Needs setup`
    : `${team} · ${known} rating${known === 1 ? "" : "s"} · ${WINDOW_LABEL}`;
}

export function summarizeBoard(cards: MetricCard[]): { known: number; above: number; below: number } {
  return {
    known: cards.filter((card) => card.value != null).length,
    above: cards.filter((card) => card.compare.tone === "above").length,
    below: cards.filter((card) => card.compare.tone === "below").length,
  };
}

export function filterOwn(rows: readonly SampleRow[], ownTeamKey: string | null): SampleRow[] {
  const own = uniqueTeamKey(ownTeamKey);
  if (!own) return [];
  return rows.filter((row) => uniqueTeamKey(row.teamKey) === own);
}

export function parseSampleRows(raw: unknown): SampleRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: SampleRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const teamKey = uniqueTeamKey(typeof record.teamKey === "string" ? record.teamKey : null);
    if (!teamKey) continue;
    const values: SampleRow["values"] = {};
    const source = record.values && typeof record.values === "object" ? (record.values as Record<string, unknown>) : record;
    for (const metric of METRICS) {
      values[metric.id] = asNumber(source[metric.id]);
    }
    rows.push({
      teamKey,
      matchKey: typeof record.matchKey === "string" ? record.matchKey : undefined,
      qual: record.qual === false ? false : true,
      values,
    });
  }
  return rows;
}

export type HistogramBin = { start: number; end: number; count: number };

export function histogram(values: readonly number[], bins = 6): HistogramBin[] {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return [];
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const count = Math.max(2, Math.min(12, Math.trunc(bins)));
  if (min === max) return [{ start: min, end: max, count: clean.length }];
  const width = (max - min) / count;
  const out: HistogramBin[] = Array.from({ length: count }, (_, index) => ({
    start: min + index * width,
    end: min + (index + 1) * width,
    count: 0,
  }));
  for (const value of clean) {
    const index = Math.min(count - 1, Math.floor((value - min) / width));
    const bin = out[index];
    if (bin) bin.count += 1;
  }
  return out;
}

export function mad(values: readonly number[]): number | null {
  const mid = median(values);
  if (mid == null) return null;
  return median(values.filter((value) => Number.isFinite(value)).map((value) => Math.abs(value - mid)));
}

export function robustZ(value: number | null, values: readonly number[]): number | null {
  if (value == null) return null;
  const mid = median(values);
  const scale = mad(values);
  if (mid == null || scale == null || scale === 0) return zScore(value, populationMean(values), populationStdDev(values));
  return (value - mid) / (1.4826 * scale);
}

export function bootstrapMean(values: readonly number[], draws = 24, seed = 761918853): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  const means: number[] = [];
  let state = seed >>> 0;
  for (let draw = 0; draw < draws; draw += 1) {
    const sample: number[] = [];
    for (let i = 0; i < clean.length; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      sample.push(clean[state % clean.length]!);
    }
    const mean = populationMean(sample);
    if (mean != null) means.push(mean);
  }
  return populationMean(means);
}

export function forecastNext(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0]!;
  const recent = ewmaSeries(clean);
  const slope = (clean[clean.length - 1]! - clean[0]!) / (clean.length - 1);
  if (recent == null) return null;
  return recent + slope * 0.35;
}

export type RoleGuess = "scorer" | "defense" | "endgame" | "flexible" | "unknown";

export function guessRole(cards: MetricCard[]): RoleGuess {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const score = byId.get(METRICS[0]!.id);
  const last = byId.get(METRICS[METRICS.length - 1]!.id);
  if (!score || score.value == null) return "unknown";
  if (score.compare.tone === "above" && (last?.compare.tone === "below" || last?.value == null)) return "scorer";
  if (last?.compare.tone === "above" && score.compare.tone !== "above") return "endgame";
  if (score.compare.tone === "near" && last?.compare.tone === "near") return "flexible";
  if (score.compare.tone === "below") return "defense";
  return "flexible";
}

export function weightedPickScore(cards: MetricCard[], weights: Partial<Record<LovatMetricId, number>>): number | null {
  let total = 0;
  let weightSum = 0;
  for (const card of cards) {
    if (card.value == null) continue;
    const weight = weights[card.id] ?? 1;
    if (weight <= 0) continue;
    const z = card.compare.z ?? 0;
    total += z * weight;
    weightSum += weight;
  }
  if (weightSum === 0) return null;
  return Math.round((total / weightSum) * 1000) / 1000;
}

export function defaultWeights(): Record<LovatMetricId, number> {
  const weights = {} as Record<LovatMetricId, number>;
  METRICS.forEach((metric, index) => {
    weights[metric.id] = metric.invert ? 0.6 : 1.15 - index * 0.08;
  });
  return weights;
}

export function rankTeams(rows: readonly SampleRow[], teamKeys: readonly string[]): Array<{ teamKey: string; score: number | null; rank: number | null }> {
  const scored = teamKeys.map((teamKey) => {
    const cards = buildCards({ teamKey, rows });
    return { teamKey: uniqueTeamKey(teamKey) ?? teamKey, score: weightedPickScore(cards, defaultWeights()) };
  });
  const known = scored
    .filter((row) => row.score != null)
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored.map((row) => ({
    ...row,
    rank: row.score == null ? null : known.findIndex((item) => item.teamKey === row.teamKey) + 1,
  }));
}

export function matchupDelta(rows: readonly SampleRow[], a: string, b: string, id: LovatMetricId): number | null {
  const left = teamValue(rows, a, id);
  const right = teamValue(rows, b, id);
  if (left == null || right == null) return null;
  return Math.round((left - right) * 1000) / 1000;
}

export function strengthOfSchedule(rows: readonly SampleRow[], oppKeys: readonly string[], id: LovatMetricId): number | null {
  const parts = oppKeys.map((teamKey) => teamValue(rows, teamKey, id));
  if (parts.every((part) => part == null)) return null;
  return populationMean(parts.filter((part): part is number => part != null));
}

export function headingBetween(a: PathPoint, b: PathPoint): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function pathCurvature(points: readonly PathPoint[]): number | null {
  if (points.length < 3) return null;
  let total = 0;
  for (let i = 2; i < points.length; i += 1) {
    const h1 = headingBetween(points[i - 2]!, points[i - 1]!);
    const h2 = headingBetween(points[i - 1]!, points[i]!);
    let delta = h2 - h1;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    total += Math.abs(delta);
  }
  return total;
}

export function stopTime(points: readonly PathPoint[], epsilon = 2): number | null {
  if (points.length < 2) return null;
  let stopped = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) <= epsilon) stopped += Math.max(0, b.t - a.t);
  }
  return stopped;
}

export function inField(point: PathPoint): boolean {
  return point.x >= 0 && point.x <= FIELD_W_IN && point.y >= 0 && point.y <= FIELD_H_IN;
}

export function pathOutOfBounds(points: readonly PathPoint[]): number {
  return points.filter((point) => !inField(point)).length;
}

export function playheadSample(paths: readonly (readonly PathPoint[])[], t: number): Array<PathPoint | null> {
  return paths.map((path) => interpolatePath(path, t));
}

export function timelineKeys(actions: readonly TimelineAction[]): string[] {
  const seen = new Set<string>();
  for (const action of actions) {
    if (action.key) seen.add(action.key);
  }
  return [...seen];
}

export function actionRate(actions: readonly TimelineAction[], key: string, seconds: number): number | null {
  const n = actions.filter((action) => action.key === key).length;
  if (n === 0 || seconds <= 0) return null;
  return n / seconds;
}

export function burstCount(actions: readonly TimelineAction[], key: string, gap = 3): number | null {
  const times = actions.filter((action) => action.key === key).map((action) => action.t).sort((a, b) => a - b);
  if (times.length === 0) return null;
  let bursts = 1;
  for (let i = 1; i < times.length; i += 1) {
    if ((times[i] ?? 0) - (times[i - 1] ?? 0) > gap) bursts += 1;
  }
  return bursts;
}

export type BoardReport = {
  slug: string;
  headline: string;
  cards: MetricCard[];
  summary: { known: number; above: number; below: number };
  role: RoleGuess;
  pickScore: number | null;
  forecast: Partial<Record<LovatMetricId, number | null>>;
  histogram: Partial<Record<LovatMetricId, HistogramBin[]>>;
};

export function buildReport(input: { teamKey: string; rows: readonly SampleRow[]; fieldRows?: readonly SampleRow[] }): BoardReport {
  const cards = buildCards(input);
  const forecast: BoardReport["forecast"] = {};
  const hist: BoardReport["histogram"] = {};
  for (const metric of METRICS) {
    const series = windowRows(input.rows)
      .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(input.teamKey))
      .map((row) => asNumber(row.values[metric.id]))
      .filter((value): value is number => value != null);
    forecast[metric.id] = forecastNext(series);
    hist[metric.id] = histogram(series);
  }
  return {
    slug: SLUG,
    headline: readyHeadline(input.teamKey, cards),
    cards,
    summary: summarizeBoard(cards),
    role: guessRole(cards),
    pickScore: weightedPickScore(cards, defaultWeights()),
    forecast,
    histogram: hist,
  };
}

export function compareReports(a: BoardReport, b: BoardReport): Array<{ id: LovatMetricId; delta: number | null }> {
  return METRICS.map((metric) => {
    const left = a.cards.find((card) => card.id === metric.id)?.value ?? null;
    const right = b.cards.find((card) => card.id === metric.id)?.value ?? null;
    return { id: metric.id, delta: left == null || right == null ? null : Math.round((left - right) * 1000) / 1000 };
  });
}

export function cardsWithValues(cards: MetricCard[]): MetricCard[] {
  return cards.filter((card) => card.value != null);
}

export function worstHole(cards: MetricCard[]): MetricCard | null {
  const known = cards.filter((card) => card.compare.tone === "below");
  if (known.length === 0) return null;
  return known.slice().sort((a, b) => (a.compare.z ?? 0) - (b.compare.z ?? 0))[0] ?? null;
}

export function bestEdge(cards: MetricCard[]): MetricCard | null {
  const known = cards.filter((card) => card.compare.tone === "above");
  if (known.length === 0) return null;
  return known.slice().sort((a, b) => (b.compare.z ?? 0) - (a.compare.z ?? 0))[0] ?? null;
}

export function setupReasons(cards: MetricCard[]): string[] {
  return cards.filter((card) => card.value == null).map((card) => `${card.label} needs a real scout row`);
}

export function studentChrome(): { rating: string; event: string; setup: string; team: string } {
  return {
    rating: "Rating",
    event: "Compared to this event",
    setup: "Needs setup",
    team: "Choose your team",
  };
}

export function eloUpdate(rating: number, opponent: number, score: 0 | 0.5 | 1, k = 24): number {
  const expected = 1 / (1 + 10 ** ((opponent - rating) / 400));
  return rating + k * (score - expected);
}

export function eloFromMatches(results: ReadonlyArray<{ won: boolean; opp: number }>, start = 1500): number | null {
  if (results.length === 0) return null;
  return results.reduce((rating, row) => eloUpdate(rating, row.opp, row.won ? 1 : 0), start);
}

export function pairwiseWins(values: readonly number[]): number {
  let wins = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i]! > values[j]!) wins += 1;
    }
  }
  return wins;
}

export function kalmanSmooth(values: readonly number[], q = 0.08, r = 0.35): number[] {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return [];
  let x = clean[0]!;
  let p = 1;
  const out: number[] = [];
  for (const z of clean) {
    p += q;
    const k = p / (p + r);
    x = x + k * (z - x);
    p = (1 - k) * p;
    out.push(x);
  }
  return out;
}

export function cycleGaps(times: readonly number[]): number[] {
  const ordered = times.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) gaps.push(ordered[i]! - ordered[i - 1]!);
  return gaps;
}

export function medianGap(times: readonly number[]): number | null {
  return median(cycleGaps(times));
}

export function scouterAgreement(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n === 0) return null;
  const diffs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) continue;
    diffs.push(Math.abs(left - right));
  }
  const mean = populationMean(diffs);
  if (mean == null) return null;
  return clamp(1 - mean / Math.max(1, Math.abs(populationMean([...a, ...b]) ?? 1)), 0, 1);
}

export function allianceCoverage(cardsByTeam: readonly MetricCard[][]): { covered: number; holes: number } {
  let covered = 0;
  let holes = 0;
  for (const metric of METRICS) {
    const values = cardsByTeam.map((cards) => cards.find((card) => card.id === metric.id)?.compare.tone);
    if (values.some((tone) => tone === "above")) covered += 1;
    else holes += 1;
  }
  return { covered, holes };
}

export function expectedAllianceScore(rows: readonly SampleRow[], teamKeys: readonly string[]): number | null {
  const parts = teamKeys.map((teamKey) => teamValue(rows, teamKey, METRICS[0]!.id));
  if (parts.some((part) => part == null)) return null;
  return parts.reduce((sum, part) => sum + (part ?? 0), 0);
}

export function winFromMargin(margin: number | null, std = 18): number | null {
  if (margin == null || std <= 0) return null;
  const z = margin / std;
  const p = 0.5 * (1 + Math.tanh(z / Math.SQRT2));
  return clamp(p, 0.02, 0.98);
}

export function clampDisplay(value: number | null, digits = 1): string {
  return formatValue(value, digits);
}

export function metricById(id: LovatMetricId): LovatMetricDef | undefined {
  return METRICS.find((metric) => metric.id === id);
}

export function invertSet(): Set<LovatMetricId> {
  return new Set(METRICS.filter((metric) => metric.invert).map((metric) => metric.id));
}

export function describeKernel(): string {
  return `${PHASE_LABEL} ${WINDOW_LABEL} using ${KERNEL_LABEL}. ${studentChrome().event}.`;
}

export function sampleCount(rows: readonly SampleRow[], teamKey: string): number {
  return windowRows(rows).filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey)).length;
}

export function hasEnough(rows: readonly SampleRow[], teamKey: string, need = 2): boolean {
  return sampleCount(rows, teamKey) >= need;
}

export function missingMetrics(cards: MetricCard[]): LovatMetricId[] {
  return cards.filter((card) => card.value == null).map((card) => card.id);
}

export function toneCounts(cards: MetricCard[]): Record<CompareTone, number> {
  return {
    above: cards.filter((card) => card.compare.tone === "above").length,
    near: cards.filter((card) => card.compare.tone === "near").length,
    below: cards.filter((card) => card.compare.tone === "below").length,
    unknown: cards.filter((card) => card.compare.tone === "unknown").length,
  };
}

export function normalizeWeights(weights: Partial<Record<LovatMetricId, number>>): Record<LovatMetricId, number> {
  const next = defaultWeights();
  let sum = 0;
  for (const metric of METRICS) {
    const value = weights[metric.id];
    next[metric.id] = value != null && Number.isFinite(value) ? Math.max(0, value) : next[metric.id];
    sum += next[metric.id];
  }
  if (sum <= 0) return defaultWeights();
  for (const metric of METRICS) next[metric.id] = next[metric.id] / sum;
  return next;
}

export function topCards(cards: MetricCard[], n = 3): MetricCard[] {
  return cardsWithValues(cards)
    .slice()
    .sort((a, b) => (b.compare.z ?? 0) - (a.compare.z ?? 0))
    .slice(0, Math.max(1, n));
}

export function rescale(value: number | null, min: number, max: number): number | null {
  if (value == null || max === min) return null;
  return clamp((value - min) / (max - min), 0, 1);
}

export function boardIsReady(cards: MetricCard[]): boolean {
  return cardsWithValues(cards).length > 0;
}


export type ZoneId = "auto-near" | "auto-far" | "mid-left" | "mid-right" | "barge-near" | "barge-far";

export type FieldZone = {
  id: ZoneId;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export const FIELD_ZONES: readonly FieldZone[] = [
  { id: "auto-near", label: "Auto near", x0: 0, y0: 0, x1: 400, y1: 405 },
  { id: "auto-far", label: "Auto far", x0: 0, y0: 406, x1: 400, y1: FIELD_H_IN },
  { id: "mid-left", label: "Mid left", x0: 401, y0: 0, x1: 1253, y1: 405 },
  { id: "mid-right", label: "Mid right", x0: 401, y0: 406, x1: 1253, y1: FIELD_H_IN },
  { id: "barge-near", label: "Barge near", x0: 1254, y0: 0, x1: FIELD_W_IN, y1: 405 },
  { id: "barge-far", label: "Barge far", x0: 1254, y0: 406, x1: FIELD_W_IN, y1: FIELD_H_IN },
];

export type SkillState = { mu: number; sigma: number };
export type DraftTier = "captain" | "first-pick" | "second-pick" | "later" | "unknown";
export type StreakKind = "hot" | "cold" | "flat" | "unknown";
export type CalibrationBin = { p: number; hit: number; n: number; brier: number | null };
export type ParetoPoint = { teamKey: string; x: number; y: number; dominated: boolean };
export type ZoneShare = { id: ZoneId; label: string; seconds: number | null; share: number | null };
export type ColleyRow = { teamKey: string; rating: number | null };
export type ResidualRow = { teamKey: string; metric: LovatMetricId; raw: number | null; expected: number | null; residual: number | null };
export type ControlLimits = { mean: number; ucl: number; lcl: number; alerts: number[] };
export type LinearFit = { slope: number; intercept: number; r2: number | null; n: number };
export type HazardPoint = { t: number; surviving: number; hazard: number | null };
export type DeepReport = {
  slug: string;
  kernel: string;
  phase: string;
  cards: MetricCard[];
  shrink: Partial<Record<LovatMetricId, number | null>>;
  streak: { kind: StreakKind; length: number | null; value: number | null };
  residuals: ResidualRow[];
  zones: ZoneShare[];
  pareto: ParetoPoint[];
  calibration: CalibrationBin[];
  brier: number | null;
  skill: SkillState | null;
  colley: ColleyRow[];
  hazard: HazardPoint[];
  draft: { tier: DraftTier; score: number | null };
  forecast: Partial<Record<LovatMetricId, number | null>>;
  fit: Partial<Record<LovatMetricId, LinearFit | null>>;
  control: Partial<Record<LovatMetricId, ControlLimits | null>>;
  quality: { completeness: number | null; outliers: number; teams: number };
};

export function streakValue(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  const mean = populationMean(clean);
  if (mean == null) return null;
  let sign = 0;
  let run = 0;
  let best = 0;
  for (const value of clean) {
    const next = value >= mean ? 1 : -1;
    if (next === sign) run += 1;
    else {
      sign = next;
      run = 1;
    }
    if (run > best) best = run;
  }
  return sign * best;
}

export function streakKind(values: readonly number[]): { kind: StreakKind; length: number | null } {
  const raw = streakValue(values);
  if (raw == null) return { kind: "unknown", length: null };
  if (raw === 0) return { kind: "flat", length: 0 };
  return { kind: raw > 0 ? "hot" : "cold", length: Math.abs(raw) };
}

export function reliabilityHazard(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  const mid = median(clean);
  if (mid == null) return null;
  const fails = clean.filter((value) => value < mid * 0.45).length;
  if (clean.length === 0) return null;
  return clamp(fails / clean.length, 0, 1);
}

export function shrinkTowardField(value: number | null, mean: number | null, n: number, k = 4): number | null {
  if (value == null) return null;
  if (mean == null || !Number.isFinite(mean) || n <= 0) return value;
  const weight = n / (n + k);
  return weight * value + (1 - weight) * mean;
}

export function zoneOf(point: PathPoint): FieldZone | null {
  if (!inField(point)) return null;
  return FIELD_ZONES.find((zone) => point.x >= zone.x0 && point.x <= zone.x1 && point.y >= zone.y0 && point.y <= zone.y1) ?? null;
}

export function resamplePath(points: readonly PathPoint[], step = 0.25): PathPoint[] {
  if (points.length < 2) return points.slice();
  const start = points[0]!.t;
  const end = points[points.length - 1]!.t;
  if (!(end > start)) return points.slice();
  const out: PathPoint[] = [];
  for (let t = start; t <= end + 1e-9; t += step) {
    const sample = interpolatePath(points, t);
    if (sample) out.push(sample);
  }
  return out;
}

export function zoneOccupancy(points: readonly PathPoint[]): ZoneShare[] {
  const samples = resamplePath(points);
  const seconds = new Map<ZoneId, number>();
  for (const zone of FIELD_ZONES) seconds.set(zone.id, 0);
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const zone = zoneOf(a);
    if (!zone) continue;
    seconds.set(zone.id, (seconds.get(zone.id) ?? 0) + Math.max(0, b.t - a.t));
  }
  const total = [...seconds.values()].reduce((sum, value) => sum + value, 0);
  return FIELD_ZONES.map((zone) => {
    const held = seconds.get(zone.id) ?? 0;
    return {
      id: zone.id,
      label: zone.label,
      seconds: total === 0 ? null : Math.round(held * 100) / 100,
      share: total === 0 ? null : held / total,
    };
  });
}

export function zoneEntropy(shares: readonly ZoneShare[]): number | null {
  const usable = shares.map((row) => row.share).filter((value): value is number => value != null && value > 0);
  if (usable.length === 0) return null;
  const entropy = usable.reduce((sum, p) => sum + -p * Math.log2(p), 0);
  return entropy;
}

export function closestApproach(a: readonly PathPoint[], b: readonly PathPoint[], step = 0.2): { t: number; distance: number } | null {
  if (a.length < 2 || b.length < 2) return null;
  const start = Math.max(a[0]!.t, b[0]!.t);
  const end = Math.min(a[a.length - 1]!.t, b[b.length - 1]!.t);
  if (!(end > start)) return null;
  let best: { t: number; distance: number } | null = null;
  for (let t = start; t <= end + 1e-9; t += step) {
    const left = interpolatePath(a, t);
    const right = interpolatePath(b, t);
    if (!left || !right) continue;
    const distance = Math.hypot(left.x - right.x, left.y - right.y);
    if (!best || distance < best.distance) best = { t: Math.round(t * 100) / 100, distance };
  }
  return best;
}

export function timeToCollision(a: readonly PathPoint[], b: readonly PathPoint[], radius = ROBOT_RADIUS_IN): number | null {
  const near = closestApproach(a, b);
  if (!near || near.distance >= radius * 2) return null;
  return near.t;
}

export function pathBoundingBox(points: readonly PathPoint[]): { w: number; h: number; area: number } | null {
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return { w, h, area: w * h };
}

export function pathSpeed(points: readonly PathPoint[]): number | null {
  const length = pathLength(points);
  const duration = pathDuration(points);
  if (length == null || duration == null || duration <= 0) return null;
  return length / duration;
}

export function linearFit(values: readonly number[]): LinearFit | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return null;
  const xs = clean.map((_, index) => index);
  const xMean = populationMean(xs);
  const yMean = populationMean(clean);
  if (xMean == null || yMean == null) return null;
  let num = 0;
  let den = 0;
  for (let i = 0; i < clean.length; i += 1) {
    num += (xs[i]! - xMean) * (clean[i]! - yMean);
    den += (xs[i]! - xMean) ** 2;
  }
  if (den === 0) return { slope: 0, intercept: yMean, r2: null, n: clean.length };
  const slope = num / den;
  const intercept = yMean - slope * xMean;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const pred = intercept + slope * xs[i]!;
    ssRes += (clean[i]! - pred) ** 2;
    ssTot += (clean[i]! - yMean) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? null : 1 - ssRes / ssTot, n: clean.length };
}

export function spearman(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const ranks = (values: readonly number[]) => {
    const ordered = values.map((value, index) => ({ value, index })).sort((l, r) => l.value - r.value);
    const out = Array.from({ length: values.length }, () => 0);
    ordered.forEach((row, rank) => {
      out[row.index] = rank + 1;
    });
    return out;
  };
  const left = ranks(a.slice(0, n));
  const right = ranks(b.slice(0, n));
  return pearson(left, right);
}

export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const xs = a.slice(0, n);
  const ys = b.slice(0, n);
  const xMean = populationMean(xs);
  const yMean = populationMean(ys);
  const xStd = populationStdDev(xs);
  const yStd = populationStdDev(ys);
  if (xMean == null || yMean == null || xStd == null || yStd == null || xStd === 0 || yStd === 0) return null;
  let cov = 0;
  for (let i = 0; i < n; i += 1) cov += (xs[i]! - xMean) * (ys[i]! - yMean);
  return cov / n / (xStd * yStd);
}

export function kendallTau(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const left = Math.sign(a[i]! - a[j]!);
      const right = Math.sign(b[i]! - b[j]!);
      if (left === 0 || right === 0) continue;
      if (left === right) concordant += 1;
      else discordant += 1;
    }
  }
  const denom = concordant + discordant;
  if (denom === 0) return null;
  return (concordant - discordant) / denom;
}

export function gini(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value) && value >= 0).slice().sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mean = populationMean(clean);
  if (mean == null || mean === 0) return null;
  let acc = 0;
  for (let i = 0; i < clean.length; i += 1) acc += (2 * (i + 1) - clean.length - 1) * clean[i]!;
  return acc / (clean.length * clean.length * mean);
}

export function theil(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  const mean = populationMean(clean);
  if (mean == null || mean === 0 || clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + (value / mean) * Math.log(value / mean), 0) / clean.length;
}

export function wilsonInterval(successes: number, n: number, z = 1.96): { lo: number; hi: number } | null {
  if (n <= 0 || successes < 0 || successes > n) return null;
  const p = successes / n;
  const den = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { lo: clamp((center - spread) / den, 0, 1), hi: clamp((center + spread) / den, 0, 1) };
}

export function betaMean(alpha: number, beta: number): number | null {
  if (alpha <= 0 || beta <= 0) return null;
  return alpha / (alpha + beta);
}

export function climbPosterior(successes: number, attempts: number, priorA = 2, priorB = 2): number | null {
  if (attempts < 0 || successes < 0 || successes > attempts) return null;
  return betaMean(priorA + successes, priorB + (attempts - successes));
}

export function poissonPmf(k: number, lambda: number): number | null {
  if (k < 0 || lambda < 0 || !Number.isFinite(lambda)) return null;
  let log = -lambda;
  for (let i = 1; i <= k; i += 1) log += Math.log(lambda) - Math.log(i);
  return Math.exp(log);
}

export function expectedCycles(rate: number | null, seconds: number): number | null {
  if (rate == null || seconds <= 0) return null;
  return rate * seconds;
}

export function brierScore(forecasts: ReadonlyArray<{ p: number; hit: boolean }>): number | null {
  if (forecasts.length === 0) return null;
  const total = forecasts.reduce((sum, row) => {
    const p = clamp(row.p, 0, 1);
    return sum + (p - (row.hit ? 1 : 0)) ** 2;
  }, 0);
  return total / forecasts.length;
}

export function logLoss(forecasts: ReadonlyArray<{ p: number; hit: boolean }>): number | null {
  if (forecasts.length === 0) return null;
  const eps = 1e-6;
  const total = forecasts.reduce((sum, row) => {
    const p = clamp(row.p, eps, 1 - eps);
    return sum + -(row.hit ? Math.log(p) : Math.log(1 - p));
  }, 0);
  return total / forecasts.length;
}

export function calibrationBins(forecasts: ReadonlyArray<{ p: number; hit: boolean }>, bins = 5): CalibrationBin[] {
  if (forecasts.length === 0) return [];
  const width = 1 / Math.max(2, bins);
  return Array.from({ length: bins }, (_, index) => {
    const lo = index * width;
    const hi = (index + 1) * width;
    const rows = forecasts.filter((row) => row.p >= lo && (index === bins - 1 ? row.p <= hi : row.p < hi));
    const hits = rows.filter((row) => row.hit).length;
    return {
      p: (lo + hi) / 2,
      hit: rows.length === 0 ? 0 : hits / rows.length,
      n: rows.length,
      brier: rows.length === 0 ? null : brierScore(rows),
    };
  });
}

export function controlLimits(values: readonly number[]): ControlLimits | null {
  const mean = populationMean(values);
  const std = populationStdDev(values);
  if (mean == null || std == null) return null;
  const ucl = mean + 3 * std;
  const lcl = mean - 3 * std;
  const alerts: number[] = [];
  values.forEach((value, index) => {
    if (Number.isFinite(value) && (value > ucl || value < lcl)) alerts.push(index);
  });
  return { mean, ucl, lcl, alerts };
}

export function cusum(values: readonly number[], k = 0.5, h = 4): number[] {
  const mean = populationMean(values);
  const std = populationStdDev(values);
  if (mean == null || std == null || std === 0) return [];
  let s = 0;
  return values.map((value) => {
    s = Math.max(0, s + (value - mean) / std - k);
    return s > h ? s : s;
  });
}

export function changePoint(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 4) return null;
  let best = 1;
  let bestScore = -Infinity;
  for (let split = 1; split < clean.length; split += 1) {
    const left = clean.slice(0, split);
    const right = clean.slice(split);
    const lMean = populationMean(left);
    const rMean = populationMean(right);
    if (lMean == null || rMean == null) continue;
    const score = Math.abs(lMean - rMean) * Math.sqrt((left.length * right.length) / clean.length);
    if (score > bestScore) {
      bestScore = score;
      best = split;
    }
  }
  return best;
}

export function outlierIndexes(values: readonly number[]): number[] {
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  if (q1 == null || q3 == null) return [];
  const fence = (q3 - q1) * 1.5;
  const out: number[] = [];
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    if (value < q1 - fence || value > q3 + fence) out.push(index);
  });
  return out;
}

export function completeness(rows: readonly SampleRow[]): number | null {
  const scoped = windowRows(rows);
  if (scoped.length === 0) return null;
  let known = 0;
  let total = 0;
  for (const row of scoped) {
    for (const metric of METRICS) {
      total += 1;
      if (asNumber(row.values[metric.id]) != null) known += 1;
    }
  }
  return total === 0 ? null : known / total;
}

export function dataQuality(rows: readonly SampleRow[]): DeepReport["quality"] {
  const values = METRICS.flatMap((metric) => valuesFor(rows, metric.id));
  return {
    completeness: completeness(rows),
    outliers: outlierIndexes(values).length,
    teams: new Set(windowRows(rows).map((row) => uniqueTeamKey(row.teamKey)).filter(Boolean)).size,
  };
}

export function opponentExpected(rows: readonly SampleRow[], oppKeys: readonly string[], id: LovatMetricId): number | null {
  return strengthOfSchedule(rows, oppKeys, id);
}

export function residualFor(rows: readonly SampleRow[], teamKey: string, id: LovatMetricId, oppKeys: readonly string[] = []): ResidualRow {
  const raw = teamValue(rows, teamKey, id);
  const expected = oppKeys.length ? opponentExpected(rows, oppKeys, id) : fieldStats(rows)[id]?.mean ?? null;
  return {
    teamKey: uniqueTeamKey(teamKey) ?? teamKey,
    metric: id,
    raw,
    expected,
    residual: raw == null || expected == null ? null : raw - expected,
  };
}

export function residualsForTeam(rows: readonly SampleRow[], teamKey: string, oppKeys: readonly string[] = []): ResidualRow[] {
  return METRICS.map((metric) => residualFor(rows, teamKey, metric.id, oppKeys));
}

export function trueskillUpdate(skill: SkillState, opp: SkillState, won: boolean, beta = 4.16): SkillState {
  const c2 = 2 * beta * beta + skill.sigma ** 2 + opp.sigma ** 2;
  const c = Math.sqrt(c2);
  const sign = won ? 1 : -1;
  const v = (skill.mu - opp.mu) / c;
  const w = 1 / Math.sqrt(2 * Math.PI) * Math.exp((-v * v) / 2);
  const mu = skill.mu + sign * ((skill.sigma ** 2) / c) * w;
  const sigma = Math.sqrt(Math.max(1e-3, skill.sigma ** 2 * (1 - (skill.sigma ** 2 / c2) * (w * (w + v)))));
  return { mu, sigma };
}

export function trueskillFromMatches(results: ReadonlyArray<{ won: boolean; oppMu: number }>, start: SkillState = { mu: 25, sigma: 8.333 }): SkillState | null {
  if (results.length === 0) return null;
  return results.reduce((skill, row) => trueskillUpdate(skill, { mu: row.oppMu, sigma: 8.333 }, row.won), start);
}

export function colleyRatings(results: ReadonlyArray<{ a: string; b: string; aWon: boolean }>): ColleyRow[] {
  const teams = [...new Set(results.flatMap((row) => [row.a, row.b]))];
  if (teams.length === 0) return [];
  const index = new Map(teams.map((team, i) => [team, i]));
  const n = teams.length;
  const C = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 2 : 0)));
  const b = Array.from({ length: n }, () => 1);
  for (const row of results) {
    const i = index.get(row.a);
    const j = index.get(row.b);
    if (i == null || j == null) continue;
    C[i]![i]! += 1;
    C[j]![j]! += 1;
    C[i]![j]! -= 1;
    C[j]![i]! -= 1;
    b[i]! += row.aWon ? 0.5 : -0.5;
    b[j]! += row.aWon ? -0.5 : 0.5;
  }
  const x = jacobiSolve(C, b);
  return teams.map((teamKey, i) => ({ teamKey, rating: x[i] ?? null }));
}

export function jacobiSolve(A: number[][], b: number[], iters = 24): number[] {
  const n = b.length;
  let x = Array.from({ length: n }, () => 0);
  for (let iter = 0; iter < iters; iter += 1) {
    const next = x.slice();
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        sum += (A[i]?.[j] ?? 0) * x[j]!;
      }
      const diag = A[i]?.[i] ?? 1;
      next[i] = ((b[i] ?? 0) - sum) / (diag === 0 ? 1 : diag);
    }
    x = next;
  }
  return x;
}

export function masseyRatings(results: ReadonlyArray<{ a: string; b: string; margin: number }>): ColleyRow[] {
  const teams = [...new Set(results.flatMap((row) => [row.a, row.b]))];
  if (teams.length === 0) return [];
  const index = new Map(teams.map((team, i) => [team, i]));
  const n = teams.length;
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  const p = Array.from({ length: n }, () => 0);
  for (const row of results) {
    const i = index.get(row.a);
    const j = index.get(row.b);
    if (i == null || j == null) continue;
    M[i]![i]! += 1;
    M[j]![j]! += 1;
    M[i]![j]! -= 1;
    M[j]![i]! -= 1;
    p[i]! += row.margin;
    p[j]! -= row.margin;
  }
  const x = jacobiSolve(M, p);
  return teams.map((teamKey, i) => ({ teamKey, rating: x[i] ?? null }));
}

export function bradleyTerry(results: ReadonlyArray<{ a: string; b: string; aWon: boolean }>, iters = 12): ColleyRow[] {
  const teams = [...new Set(results.flatMap((row) => [row.a, row.b]))];
  if (teams.length === 0) return [];
  const strength = new Map(teams.map((team) => [team, 1]));
  for (let iter = 0; iter < iters; iter += 1) {
    const next = new Map(strength);
    for (const team of teams) {
      let num = 0;
      let den = 0;
      for (const row of results) {
        const opp = row.a === team ? row.b : row.b === team ? row.a : null;
        if (!opp) continue;
        const sa = strength.get(row.a) ?? 1;
        const sb = strength.get(row.b) ?? 1;
        if (row.a === team && row.aWon) num += 1;
        if (row.b === team && !row.aWon) num += 1;
        den += 1 / (sa + sb);
      }
      next.set(team, den === 0 ? 1 : Math.max(0.05, num / den));
    }
    for (const team of teams) strength.set(team, next.get(team) ?? 1);
  }
  return teams.map((teamKey) => ({ teamKey, rating: strength.get(teamKey) ?? null }));
}

export function commonOpponent(rows: readonly SampleRow[], a: string, b: string, id: LovatMetricId): number | null {
  const left = teamValue(rows, a, id);
  const right = teamValue(rows, b, id);
  if (left == null || right == null) return null;
  return left - right;
}

export function shapleyCredit(values: readonly number[]): number[] | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values.map(() => 0);
  return values.map((value) => value / total);
}

export function counterfactualSwap(rows: readonly SampleRow[], alliance: readonly string[], replace: string, withTeam: string, id: LovatMetricId): number | null {
  const before = allianceSum(rows, alliance, id);
  const next = alliance.map((team) => (uniqueTeamKey(team) === uniqueTeamKey(replace) ? withTeam : team));
  const after = allianceSum(rows, next, id);
  if (before == null || after == null) return null;
  return after - before;
}

export function paretoFront(points: ReadonlyArray<{ teamKey: string; x: number; y: number }>): ParetoPoint[] {
  return points.map((point) => ({
    ...point,
    dominated: points.some((other) => other !== point && other.x >= point.x && other.y >= point.y && (other.x > point.x || other.y > point.y)),
  }));
}

export function topsis(rows: Array<{ teamKey: string; values: number[] }>, weights: readonly number[]): Array<{ teamKey: string; score: number | null }> {
  if (rows.length === 0) return [];
  const dims = weights.length;
  const cols = Array.from({ length: dims }, (_, j) => {
    const sq = Math.sqrt(rows.reduce((sum, row) => sum + (row.values[j] ?? 0) ** 2, 0));
    return sq === 0 ? 1 : sq;
  });
  const weighted = rows.map((row) => row.values.map((value, j) => ((value ?? 0) / cols[j]!) * (weights[j] ?? 1)));
  const ideal = Array.from({ length: dims }, (_, j) => Math.max(...weighted.map((row) => row[j] ?? 0)));
  const nadir = Array.from({ length: dims }, (_, j) => Math.min(...weighted.map((row) => row[j] ?? 0)));
  return rows.map((row, i) => {
    const dPos = Math.hypot(...weighted[i]!.map((value, j) => value - ideal[j]!));
    const dNeg = Math.hypot(...weighted[i]!.map((value, j) => value - nadir[j]!));
    const den = dPos + dNeg;
    return { teamKey: row.teamKey, score: den === 0 ? null : dNeg / den };
  });
}

export function draftTier(score: number | null, field: readonly number[]): DraftTier {
  if (score == null || field.length === 0) return "unknown";
  const p90 = percentile(field, 0.9);
  const p70 = percentile(field, 0.7);
  const p40 = percentile(field, 0.4);
  if (p90 != null && score >= p90) return "captain";
  if (p70 != null && score >= p70) return "first-pick";
  if (p40 != null && score >= p40) return "second-pick";
  return "later";
}

export function runningRank(series: readonly number[]): Array<number | null> {
  return series.map((_, index) => denseRank(series[index] ?? null, series.slice(0, index + 1)));
}

export function drawdown(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  let peak = clean[0]!;
  let worst = 0;
  for (const value of clean) {
    if (value > peak) peak = value;
    worst = Math.min(worst, value - peak);
  }
  return worst;
}

export function recoveryMatches(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  let peak = clean[0]!;
  let troughAt: number | null = null;
  for (let i = 0; i < clean.length; i += 1) {
    if (clean[i]! > peak) peak = clean[i]!;
    if (troughAt == null && clean[i]! < peak) troughAt = i;
    if (troughAt != null && clean[i]! >= peak) return i - troughAt;
  }
  return null;
}

export function hazardCurve(values: readonly number[]): HazardPoint[] {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return [];
  const mid = median(clean) ?? 0;
  let surviving = clean.length;
  return clean.map((value, index) => {
    const fail = value < mid * 0.45 ? 1 : 0;
    const hazard = surviving === 0 ? null : fail / surviving;
    surviving -= fail;
    return { t: index + 1, surviving, hazard };
  });
}

export function forecastsFromSeries(values: readonly number[]): Array<{ p: number; hit: boolean }> {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 3) return [];
  const out: Array<{ p: number; hit: boolean }> = [];
  for (let i = 2; i < clean.length; i += 1) {
    const prior = clean.slice(0, i);
    const mean = populationMean(prior);
    const std = populationStdDev(prior);
    if (mean == null || std == null) continue;
    const p = winFromMargin((clean[i]! - mean), Math.max(1, std * 4)) ?? 0.5;
    out.push({ p, hit: clean[i]! >= mean });
  }
  return out;
}

export function matchResultsFromRows(rows: readonly SampleRow[], id: LovatMetricId): Array<{ a: string; b: string; aWon: boolean; margin: number }> {
  const scoped = windowRows(rows);
  const byMatch = new Map<string, SampleRow[]>();
  scoped.forEach((row, index) => {
    const key = row.matchKey ?? `anon-${index}`;
    const list = byMatch.get(key) ?? [];
    list.push(row);
    byMatch.set(key, list);
  });
  const results: Array<{ a: string; b: string; aWon: boolean; margin: number }> = [];
  for (const group of byMatch.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const av = asNumber(group[i]!.values[id]);
        const bv = asNumber(group[j]!.values[id]);
        if (av == null || bv == null) continue;
        results.push({
          a: group[i]!.teamKey,
          b: group[j]!.teamKey,
          aWon: av >= bv,
          margin: av - bv,
        });
      }
    }
  }
  return results;
}

export function skillFromRows(rows: readonly SampleRow[], teamKey: string, id: LovatMetricId): SkillState | null {
  const mine = uniqueTeamKey(teamKey);
  if (!mine) return null;
  const results = matchResultsFromRows(rows, id)
    .filter((row) => uniqueTeamKey(row.a) === mine || uniqueTeamKey(row.b) === mine)
    .map((row) => ({
      won: uniqueTeamKey(row.a) === mine ? row.aWon : !row.aWon,
      oppMu: 25,
    }));
  return trueskillFromMatches(results);
}

export function pickAxis(cards: MetricCard[], index: 0 | 1): number | null {
  const card = cards[index] ?? cards[0];
  return card?.value ?? null;
}

export function paretoFromRows(rows: readonly SampleRow[], teamKeys: readonly string[]): ParetoPoint[] {
  const points = teamKeys
    .map((teamKey) => {
      const cards = buildCards({ teamKey, rows });
      const x = pickAxis(cards, 0);
      const y = pickAxis(cards, 1);
      if (x == null || y == null) return null;
      return { teamKey: uniqueTeamKey(teamKey) ?? teamKey, x, y };
    })
    .filter((row): row is { teamKey: string; x: number; y: number } => row != null);
  return paretoFront(points);
}

export function buildDeepReport(input: {
  teamKey: string;
  rows: readonly SampleRow[];
  fieldRows?: readonly SampleRow[];
  oppKeys?: readonly string[];
}): DeepReport {
  const cards = buildCards(input);
  const field = input.fieldRows ?? input.rows;
  const series0 = valuesFor(
    windowRows(input.rows).filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(input.teamKey)),
    METRICS[0]!.id,
  );
  const teamSeries = (id: LovatMetricId) =>
    windowRows(input.rows)
      .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(input.teamKey))
      .map((row) => asNumber(row.values[id]))
      .filter((value): value is number => value != null);
  const shrink: DeepReport["shrink"] = {};
  const forecast: DeepReport["forecast"] = {};
  const fit: DeepReport["fit"] = {};
  const control: DeepReport["control"] = {};
  for (const metric of METRICS) {
    const series = teamSeries(metric.id);
    const stat = fieldStats(field)[metric.id];
    shrink[metric.id] = shrinkTowardField(teamValue(input.rows, input.teamKey, metric.id), stat?.mean ?? null, series.length);
    forecast[metric.id] = forecastNext(series);
    fit[metric.id] = linearFit(series);
    control[metric.id] = controlLimits(series);
  }
  const paths = windowRows(input.rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(input.teamKey) && row.path && row.path.length >= 2)
    .map((row) => row.path!);
  const zones = paths[0] ? zoneOccupancy(paths[0]) : FIELD_ZONES.map((zone) => ({ id: zone.id, label: zone.label, seconds: null, share: null }));
  const forecasts = forecastsFromSeries(series0);
  const teamKeys = [...new Set(windowRows(field).map((row) => row.teamKey))];
  const scores = rankTeams(field, teamKeys)
    .map((row) => row.score)
    .filter((value): value is number => value != null);
  const pick = weightedPickScore(cards, defaultWeights());
  const results = matchResultsFromRows(field, METRICS[0]!.id);
  return {
    slug: SLUG,
    kernel: "residual",
    phase: "teleop",
    cards,
    shrink,
    streak: { ...streakKind(series0), value: streakValue(series0) },
    residuals: residualsForTeam(input.rows, input.teamKey, input.oppKeys ?? []),
    zones,
    pareto: paretoFromRows(field, teamKeys.slice(0, 12)),
    calibration: calibrationBins(forecasts),
    brier: brierScore(forecasts),
    skill: skillFromRows(field, input.teamKey, METRICS[0]!.id),
    colley: colleyRatings(results),
    hazard: hazardCurve(series0),
    draft: { tier: draftTier(pick, scores), score: pick },
    forecast,
    fit,
    control,
    quality: dataQuality(input.rows),
  };
}

export function deepHeadline(report: DeepReport): string {
  if (!boardIsReady(report.cards)) return `Needs setup · ${PHASE_LABEL}`;
  const streak = report.streak.kind === "unknown" ? "no streak yet" : `${report.streak.kind} ${report.streak.length ?? 0}`;
  return `${report.draft.tier} · ${streak} · ${WINDOW_LABEL}`;
}

export function zoneBars(shares: readonly ZoneShare[]): Array<{ label: string; width: number; empty: boolean }> {
  return shares.map((row) => ({
    label: row.label,
    width: row.share == null ? 0 : Math.round(row.share * 100),
    empty: row.share == null,
  }));
}

export function formatTier(tier: DraftTier): string {
  switch (tier) {
    case "captain":
      return "Captain range";
    case "first-pick":
      return "First-pick range";
    case "second-pick":
      return "Second-pick range";
    case "later":
      return "Later board";
    case "unknown":
      return "Needs setup";
    default: {
      const _never: never = tier;
      return _never;
    }
  }
}

export function formatStreak(kind: StreakKind): string {
  switch (kind) {
    case "hot":
      return "Hot streak";
    case "cold":
      return "Cold streak";
    case "flat":
      return "Even stretch";
    case "unknown":
      return "Needs setup";
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function deepReasons(report: DeepReport): string[] {
  const reasons = setupReasons(report.cards);
  if (report.quality.completeness == null) reasons.push("No windowed scout rows yet");
  if (report.zones.every((zone) => zone.share == null)) reasons.push("No auto path samples yet");
  if (report.brier == null) reasons.push("Not enough matches to score forecasts");
  if (report.skill == null) reasons.push("Skill posterior stays blank without paired results");
  return reasons;
}

export function kernelUsesPath(): boolean {
  return false;
}

export function kernelUsesAlliance(): boolean {
  return false;
}

export function kernelUsesForecast(): boolean {
  return false;
}

export function noticeableFocus(): string {
  if (kernelUsesPath()) return "Path geometry and zone occupancy stay blank until a real auto path exists.";
  if (kernelUsesAlliance()) return "Alliance combination and draft tier use only teams with real ratings.";
  if (kernelUsesForecast()) return "Forecast calibration never fills a hit rate from a missing match.";
  return describeKernel();
}

export function clampShare(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatFit(fit: LinearFit | null): string {
  if (!fit) return "—";
  const slope = formatValue(fit.slope, 2);
  const r2 = fit.r2 == null ? "—" : formatValue(fit.r2, 2);
  return `slope ${slope} · r² ${r2}`;
}

export function formatSkill(skill: SkillState | null): string {
  if (!skill) return "Needs setup";
  return `μ ${formatValue(skill.mu, 1)} · σ ${formatValue(skill.sigma, 2)}`;
}

export function formatControl(limits: ControlLimits | null): string {
  if (!limits) return "—";
  return limits.alerts.length === 0 ? "Inside limits" : `${limits.alerts.length} alert${limits.alerts.length === 1 ? "" : "s"}`;
}

export function sortColley(rows: readonly ColleyRow[]): ColleyRow[] {
  return rows.slice().sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity));
}

export function undominated(points: readonly ParetoPoint[]): ParetoPoint[] {
  return points.filter((point) => !point.dominated);
}

export function residualTone(value: number | null): CompareTone {
  if (value == null) return "unknown";
  if (Math.abs(value) < NEAR_Z) return "near";
  return value > 0 ? "above" : "below";
}

export function qualityLabel(quality: DeepReport["quality"]): string {
  if (quality.completeness == null) return "Needs setup";
  return `${Math.round(quality.completeness * 100)}% filled · ${quality.teams} teams`;
}

export function exportDeepRows(report: DeepReport): Array<Record<string, string | number | null>> {
  return report.cards.map((card) => ({
    metric: card.id,
    value: card.value,
    display: card.display,
    tone: card.compare.tone,
    shrink: report.shrink[card.id] ?? null,
    forecast: report.forecast[card.id] ?? null,
  }));
}

export function boardSections(report: DeepReport): Array<{ id: string; title: string; body: string }> {
  return [
    { id: "compare", title: studentChrome().event, body: noticeableFocus() },
    { id: "draft", title: "Draft board", body: formatTier(report.draft.tier) },
    { id: "streak", title: "Streak", body: formatStreak(report.streak.kind) },
    { id: "skill", title: "Skill", body: formatSkill(report.skill) },
    { id: "quality", title: "Scout fill", body: qualityLabel(report.quality) },
    { id: "brier", title: "Forecast score", body: formatValue(report.brier, 3) },
  ];
}

export function emptyDeepCopy(): { badge: string; title: string; description: string } {
  const empty = emptyCopy();
  return {
    ...empty,
    description: `${empty.description} Deep board (shrink, streak, zones, Colley, calibration) stays blank too.`,
  };
}
