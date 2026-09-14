/**
 * Lovat-style Auto board — last 6 matches, dense rank.
 * Missing samples stay blank. Nothing here invents a rating.
 */

export const SLUG = "auto-last6-rank";
export const PHASE_LABEL = "Auto";
export const WINDOW_LABEL = "last 6 matches";
export const KERNEL_LABEL = "dense rank";
export const WINDOW_N: number | null = 6;
export const QUALS_ONLY = false;
export const EWMA_ALPHA = 0.270;
export const TRIM_FRACTION = 0.106;
export const NEAR_Z = 0.285;
export const ROBOT_RADIUS_IN = 14.0;
export const FIELD_W_IN = 1654;
export const FIELD_H_IN = 811;

export type LovatMetricId = "autoPoints" | "autoFuel" | "autoLeave" | "autoClimb";

export type LovatMetricDef = {
  id: LovatMetricId;
  label: string;
  invert: boolean;
};

export const METRICS: readonly LovatMetricDef[] = [
  {
    "id": "autoPoints",
    "label": "Auto points",
    "invert": false
  },
  {
    "id": "autoFuel",
    "label": "Auto fuel",
    "invert": false
  },
  {
    "id": "autoLeave",
    "label": "Auto leave",
    "invert": false
  },
  {
    "id": "autoClimb",
    "label": "Auto climb",
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
  switch ("rank") {
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

export function bootstrapMean(values: readonly number[], draws = 24, seed = 1459210482): number | null {
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
