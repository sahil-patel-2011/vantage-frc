/**
 * Lovat-style Endgame board — last 4 matches, hot-cold streak.
 * Missing samples stay blank. Nothing here invents a rating.
 */

export const SLUG = "endgame-last4-streak";
export const PHASE_LABEL = "Endgame";
export const WINDOW_LABEL = "last 4 matches";
export const KERNEL_LABEL = "hot-cold streak";
export const WINDOW_N: number | null = 4;
export const QUALS_ONLY = false;
export const PLAYOFFS_ONLY = false;
export const EWMA_ALPHA = 0.647;
export const TRIM_FRACTION = 0.232;
export const NEAR_Z = 0.385;
export const ROBOT_RADIUS_IN = 18.0;
export const FIELD_W_IN = 1654;
export const FIELD_H_IN = 811;

export type LovatMetricId = "endgameClimb" | "towerLevel" | "park" | "endgamePoints";

export type LovatMetricDef = {
  id: LovatMetricId;
  label: string;
  invert: boolean;
};

export const METRICS: readonly LovatMetricDef[] = [
  {
    "id": "endgameClimb",
    "label": "Endgame climb",
    "invert": false
  },
  {
    "id": "towerLevel",
    "label": "Tower level",
    "invert": false
  },
  {
    "id": "park",
    "label": "Park",
    "invert": false
  },
  {
    "id": "endgamePoints",
    "label": "Endgame points",
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
  switch ("streak") {
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

export function bootstrapMean(values: readonly number[], draws = 24, seed = 2212238854): number | null {
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
    kernel: "streak",
    phase: "endgame",
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
  return true;
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

export type WideStat = {
  n: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  iqr: number | null;
  mad: number | null;
  hl: number | null;
  sen: number | null;
  lcv: number | null;
  outliers: number;
};

export type SlotSlice = {
  index: number;
  label: string;
  n: number;
  mean: number | null;
  tone: CompareTone;
};

export type ScoutSlice = {
  key: string;
  label: string;
  agreement: number | null;
  filled: number | null;
};

export type WideMetricPack = {
  id: LovatMetricId;
  label: string;
  series: number[];
  stat: WideStat;
  shrink: number | null;
  forecast: number | null;
  fit: LinearFit | null;
  control: ControlLimits | null;
  slots: SlotSlice[];
};

export type WideReport = {
  slug: string;
  packs: WideMetricPack[];
  scouts: ScoutSlice[];
  slots: SlotSlice[];
  quality: DeepReport["quality"];
  headline: string;
};

export function cleanFinite(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

export function hodgesLehmann(values: readonly number[]): number | null {
  const clean = cleanFinite(values).slice().sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const pair: number[] = [];
  for (let i = 0; i < clean.length; i += 1) {
    for (let j = i; j < clean.length; j += 1) pair.push((clean[i]! + clean[j]!) / 2);
  }
  return median(pair);
}

export function theilSen(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  if (clean.length < 2) return null;
  const slopes: number[] = [];
  for (let i = 0; i < clean.length; i += 1) {
    for (let j = i + 1; j < clean.length; j += 1) {
      const dx = j - i;
      if (dx === 0) continue;
      slopes.push((clean[j]! - clean[i]!) / dx);
    }
  }
  return median(slopes);
}

export function lMomentCv(values: readonly number[]): number | null {
  const clean = cleanFinite(values).slice().sort((a, b) => a - b);
  if (clean.length < 2) return null;
  const l1 = populationMean(clean);
  if (l1 == null || l1 === 0) return null;
  let l2 = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const weight = (2 * (i + 1) - clean.length - 1) / (clean.length * (clean.length - 1));
    l2 += weight * clean[i]!;
  }
  return Math.abs(l2 / l1);
}

export function meanAbsDev(values: readonly number[]): number | null {
  const mean = populationMean(values);
  if (mean == null) return null;
  return populationMean(cleanFinite(values).map((value) => Math.abs(value - mean)));
}

export function rangeWidth(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  if (clean.length === 0) return null;
  return Math.max(...clean) - Math.min(...clean);
}

export function quartileSkew(values: readonly number[]): number | null {
  const q1 = percentile(values, 0.25);
  const q2 = percentile(values, 0.5);
  const q3 = percentile(values, 0.75);
  if (q1 == null || q2 == null || q3 == null) return null;
  const den = q3 - q1;
  if (den === 0) return 0;
  return (q3 + q1 - 2 * q2) / den;
}

export function wideStat(values: readonly number[]): WideStat {
  const clean = cleanFinite(values);
  return {
    n: clean.length,
    mean: populationMean(clean),
    median: median(clean),
    std: populationStdDev(clean),
    iqr: iqr(clean),
    mad: mad(clean),
    hl: hodgesLehmann(clean),
    sen: theilSen(clean),
    lcv: lMomentCv(clean),
    outliers: outlierIndexes(clean).length,
  };
}

export function slotLabel(index: number): string {
  return `Match ${index + 1}`;
}

export function slotSlices(values: readonly number[], slots = 24): SlotSlice[] {
  const clean = cleanFinite(values);
  const mean = populationMean(clean);
  const std = populationStdDev(clean);
  return Array.from({ length: slots }, (_, index) => {
    const value = clean[index] ?? null;
    const compare = fieldCompare(value, mean, std);
    return {
      index,
      label: slotLabel(index),
      n: value == null ? 0 : 1,
      mean: value,
      tone: compare.tone,
    };
  });
}

export function scoutLabel(key: string): string {
  switch (key) {
    case "lead":
      return "Lead scout";
    case "stand":
      return "Stand scout";
    case "pit":
      return "Pit notes";
    case "drive":
      return "Drive team";
    case "alliance":
      return "Alliance captain";
    case "replay":
      return "Replay";
    case "second":
      return "Second pass";
    case "audit":
      return "Audit";
    default:
      return key;
  }
}

export function scoutSlices(values: readonly number[]): ScoutSlice[] {
  const keys = ["lead","stand","pit","drive","alliance","replay","second","audit"];
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(half);
  return keys.map((key, index) => {
    const offset = values.slice(index, index + half);
    return {
      key,
      label: scoutLabel(key),
      agreement: scouterAgreement(left, offset.length ? offset : right),
      filled: offset.length === 0 ? null : offset.filter((value) => Number.isFinite(value)).length / Math.max(1, offset.length),
    };
  });
}

export function formatWideStat(stat: WideStat): string {
  if (stat.n === 0) return "Needs setup";
  return `n ${stat.n} · μ ${formatValue(stat.mean, 1)} · HL ${formatValue(stat.hl, 1)}`;
}

export function formatSlot(slot: SlotSlice): string {
  if (slot.mean == null) return `${slot.label}: Needs setup`;
  return `${slot.label}: ${formatValue(slot.mean, 1)} · ${slot.tone}`;
}

export function formatScout(slice: ScoutSlice): string {
  if (slice.agreement == null) return `${slice.label}: Needs setup`;
  return `${slice.label}: ${Math.round(slice.agreement * 100)}% agree`;
}

export function seriesEndgameClimb(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => asNumber(row.values["endgameClimb" as LovatMetricId]))
    .filter((value): value is number => value != null);
}

export function statEndgameClimb(rows: readonly SampleRow[], teamKey: string): WideStat {
  return wideStat(seriesEndgameClimb(rows, teamKey));
}

export function shrinkEndgameClimb(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const series = seriesEndgameClimb(rows, teamKey);
  const field = fieldStats(fieldRows ?? rows)["endgameClimb" as LovatMetricId];
  return shrinkTowardField(teamValue(rows, teamKey, "endgameClimb" as LovatMetricId), field?.mean ?? null, series.length);
}

export function forecastEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return forecastNext(seriesEndgameClimb(rows, teamKey));
}

export function fitEndgameClimb(rows: readonly SampleRow[], teamKey: string): LinearFit | null {
  return linearFit(seriesEndgameClimb(rows, teamKey));
}

export function controlEndgameClimb(rows: readonly SampleRow[], teamKey: string): ControlLimits | null {
  return controlLimits(seriesEndgameClimb(rows, teamKey));
}

export function slotsEndgameClimb(rows: readonly SampleRow[], teamKey: string): SlotSlice[] {
  return slotSlices(seriesEndgameClimb(rows, teamKey));
}

export function residualEndgameClimb(rows: readonly SampleRow[], teamKey: string, oppKeys: readonly string[] = []): ResidualRow {
  return residualFor(rows, teamKey, "endgameClimb" as LovatMetricId, oppKeys);
}

export function histEndgameClimb(rows: readonly SampleRow[], teamKey: string): HistogramBin[] {
  return histogram(seriesEndgameClimb(rows, teamKey));
}

export function cvEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return coefficientOfVariation(seriesEndgameClimb(rows, teamKey));
}

export function trimEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return trimmedMean(seriesEndgameClimb(rows, teamKey));
}

export function ewmaEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return ewmaSeries(seriesEndgameClimb(rows, teamKey));
}

export function jackEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return jackknifeMean(seriesEndgameClimb(rows, teamKey));
}

export function bootEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return bootstrapMean(seriesEndgameClimb(rows, teamKey));
}

export function hazardEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return reliabilityHazard(seriesEndgameClimb(rows, teamKey));
}

export function streakEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return streakValue(seriesEndgameClimb(rows, teamKey));
}

export function giniEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return gini(seriesEndgameClimb(rows, teamKey));
}

export function theilEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return theil(seriesEndgameClimb(rows, teamKey));
}

export function skewEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return quartileSkew(seriesEndgameClimb(rows, teamKey));
}

export function rangeEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return rangeWidth(seriesEndgameClimb(rows, teamKey));
}

export function madMeanEndgameClimb(rows: readonly SampleRow[], teamKey: string): number | null {
  return meanAbsDev(seriesEndgameClimb(rows, teamKey));
}

export function packEndgameClimb(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): WideMetricPack {
  const series = seriesEndgameClimb(rows, teamKey);
  return {
    id: "endgameClimb" as LovatMetricId,
    label: "Endgame climb",
    series,
    stat: wideStat(series),
    shrink: shrinkEndgameClimb(rows, teamKey, fieldRows),
    forecast: forecastEndgameClimb(rows, teamKey),
    fit: fitEndgameClimb(rows, teamKey),
    control: controlEndgameClimb(rows, teamKey),
    slots: slotsEndgameClimb(rows, teamKey),
  };
}

export function describeEndgameClimb(pack: WideMetricPack): string {
  if (pack.stat.n === 0) return `Endgame climb · Needs setup`;
  return `Endgame climb · ${formatWideStat(pack.stat)} · forecast ${formatValue(pack.forecast, 1)}`;
}

export function seriesTowerLevel(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => asNumber(row.values["towerLevel" as LovatMetricId]))
    .filter((value): value is number => value != null);
}

export function statTowerLevel(rows: readonly SampleRow[], teamKey: string): WideStat {
  return wideStat(seriesTowerLevel(rows, teamKey));
}

export function shrinkTowerLevel(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const series = seriesTowerLevel(rows, teamKey);
  const field = fieldStats(fieldRows ?? rows)["towerLevel" as LovatMetricId];
  return shrinkTowardField(teamValue(rows, teamKey, "towerLevel" as LovatMetricId), field?.mean ?? null, series.length);
}

export function forecastTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return forecastNext(seriesTowerLevel(rows, teamKey));
}

export function fitTowerLevel(rows: readonly SampleRow[], teamKey: string): LinearFit | null {
  return linearFit(seriesTowerLevel(rows, teamKey));
}

export function controlTowerLevel(rows: readonly SampleRow[], teamKey: string): ControlLimits | null {
  return controlLimits(seriesTowerLevel(rows, teamKey));
}

export function slotsTowerLevel(rows: readonly SampleRow[], teamKey: string): SlotSlice[] {
  return slotSlices(seriesTowerLevel(rows, teamKey));
}

export function residualTowerLevel(rows: readonly SampleRow[], teamKey: string, oppKeys: readonly string[] = []): ResidualRow {
  return residualFor(rows, teamKey, "towerLevel" as LovatMetricId, oppKeys);
}

export function histTowerLevel(rows: readonly SampleRow[], teamKey: string): HistogramBin[] {
  return histogram(seriesTowerLevel(rows, teamKey));
}

export function cvTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return coefficientOfVariation(seriesTowerLevel(rows, teamKey));
}

export function trimTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return trimmedMean(seriesTowerLevel(rows, teamKey));
}

export function ewmaTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return ewmaSeries(seriesTowerLevel(rows, teamKey));
}

export function jackTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return jackknifeMean(seriesTowerLevel(rows, teamKey));
}

export function bootTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return bootstrapMean(seriesTowerLevel(rows, teamKey));
}

export function hazardTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return reliabilityHazard(seriesTowerLevel(rows, teamKey));
}

export function streakTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return streakValue(seriesTowerLevel(rows, teamKey));
}

export function giniTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return gini(seriesTowerLevel(rows, teamKey));
}

export function theilTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return theil(seriesTowerLevel(rows, teamKey));
}

export function skewTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return quartileSkew(seriesTowerLevel(rows, teamKey));
}

export function rangeTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return rangeWidth(seriesTowerLevel(rows, teamKey));
}

export function madMeanTowerLevel(rows: readonly SampleRow[], teamKey: string): number | null {
  return meanAbsDev(seriesTowerLevel(rows, teamKey));
}

export function packTowerLevel(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): WideMetricPack {
  const series = seriesTowerLevel(rows, teamKey);
  return {
    id: "towerLevel" as LovatMetricId,
    label: "Tower level",
    series,
    stat: wideStat(series),
    shrink: shrinkTowerLevel(rows, teamKey, fieldRows),
    forecast: forecastTowerLevel(rows, teamKey),
    fit: fitTowerLevel(rows, teamKey),
    control: controlTowerLevel(rows, teamKey),
    slots: slotsTowerLevel(rows, teamKey),
  };
}

export function describeTowerLevel(pack: WideMetricPack): string {
  if (pack.stat.n === 0) return `Tower level · Needs setup`;
  return `Tower level · ${formatWideStat(pack.stat)} · forecast ${formatValue(pack.forecast, 1)}`;
}

export function seriesPark(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => asNumber(row.values["park" as LovatMetricId]))
    .filter((value): value is number => value != null);
}

export function statPark(rows: readonly SampleRow[], teamKey: string): WideStat {
  return wideStat(seriesPark(rows, teamKey));
}

export function shrinkPark(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const series = seriesPark(rows, teamKey);
  const field = fieldStats(fieldRows ?? rows)["park" as LovatMetricId];
  return shrinkTowardField(teamValue(rows, teamKey, "park" as LovatMetricId), field?.mean ?? null, series.length);
}

export function forecastPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return forecastNext(seriesPark(rows, teamKey));
}

export function fitPark(rows: readonly SampleRow[], teamKey: string): LinearFit | null {
  return linearFit(seriesPark(rows, teamKey));
}

export function controlPark(rows: readonly SampleRow[], teamKey: string): ControlLimits | null {
  return controlLimits(seriesPark(rows, teamKey));
}

export function slotsPark(rows: readonly SampleRow[], teamKey: string): SlotSlice[] {
  return slotSlices(seriesPark(rows, teamKey));
}

export function residualPark(rows: readonly SampleRow[], teamKey: string, oppKeys: readonly string[] = []): ResidualRow {
  return residualFor(rows, teamKey, "park" as LovatMetricId, oppKeys);
}

export function histPark(rows: readonly SampleRow[], teamKey: string): HistogramBin[] {
  return histogram(seriesPark(rows, teamKey));
}

export function cvPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return coefficientOfVariation(seriesPark(rows, teamKey));
}

export function trimPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return trimmedMean(seriesPark(rows, teamKey));
}

export function ewmaPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return ewmaSeries(seriesPark(rows, teamKey));
}

export function jackPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return jackknifeMean(seriesPark(rows, teamKey));
}

export function bootPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return bootstrapMean(seriesPark(rows, teamKey));
}

export function hazardPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return reliabilityHazard(seriesPark(rows, teamKey));
}

export function streakPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return streakValue(seriesPark(rows, teamKey));
}

export function giniPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return gini(seriesPark(rows, teamKey));
}

export function theilPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return theil(seriesPark(rows, teamKey));
}

export function skewPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return quartileSkew(seriesPark(rows, teamKey));
}

export function rangePark(rows: readonly SampleRow[], teamKey: string): number | null {
  return rangeWidth(seriesPark(rows, teamKey));
}

export function madMeanPark(rows: readonly SampleRow[], teamKey: string): number | null {
  return meanAbsDev(seriesPark(rows, teamKey));
}

export function packPark(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): WideMetricPack {
  const series = seriesPark(rows, teamKey);
  return {
    id: "park" as LovatMetricId,
    label: "Park",
    series,
    stat: wideStat(series),
    shrink: shrinkPark(rows, teamKey, fieldRows),
    forecast: forecastPark(rows, teamKey),
    fit: fitPark(rows, teamKey),
    control: controlPark(rows, teamKey),
    slots: slotsPark(rows, teamKey),
  };
}

export function describePark(pack: WideMetricPack): string {
  if (pack.stat.n === 0) return `Park · Needs setup`;
  return `Park · ${formatWideStat(pack.stat)} · forecast ${formatValue(pack.forecast, 1)}`;
}

export function seriesEndgamePoints(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => asNumber(row.values["endgamePoints" as LovatMetricId]))
    .filter((value): value is number => value != null);
}

export function statEndgamePoints(rows: readonly SampleRow[], teamKey: string): WideStat {
  return wideStat(seriesEndgamePoints(rows, teamKey));
}

export function shrinkEndgamePoints(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const series = seriesEndgamePoints(rows, teamKey);
  const field = fieldStats(fieldRows ?? rows)["endgamePoints" as LovatMetricId];
  return shrinkTowardField(teamValue(rows, teamKey, "endgamePoints" as LovatMetricId), field?.mean ?? null, series.length);
}

export function forecastEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return forecastNext(seriesEndgamePoints(rows, teamKey));
}

export function fitEndgamePoints(rows: readonly SampleRow[], teamKey: string): LinearFit | null {
  return linearFit(seriesEndgamePoints(rows, teamKey));
}

export function controlEndgamePoints(rows: readonly SampleRow[], teamKey: string): ControlLimits | null {
  return controlLimits(seriesEndgamePoints(rows, teamKey));
}

export function slotsEndgamePoints(rows: readonly SampleRow[], teamKey: string): SlotSlice[] {
  return slotSlices(seriesEndgamePoints(rows, teamKey));
}

export function residualEndgamePoints(rows: readonly SampleRow[], teamKey: string, oppKeys: readonly string[] = []): ResidualRow {
  return residualFor(rows, teamKey, "endgamePoints" as LovatMetricId, oppKeys);
}

export function histEndgamePoints(rows: readonly SampleRow[], teamKey: string): HistogramBin[] {
  return histogram(seriesEndgamePoints(rows, teamKey));
}

export function cvEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return coefficientOfVariation(seriesEndgamePoints(rows, teamKey));
}

export function trimEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return trimmedMean(seriesEndgamePoints(rows, teamKey));
}

export function ewmaEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return ewmaSeries(seriesEndgamePoints(rows, teamKey));
}

export function jackEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return jackknifeMean(seriesEndgamePoints(rows, teamKey));
}

export function bootEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return bootstrapMean(seriesEndgamePoints(rows, teamKey));
}

export function hazardEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return reliabilityHazard(seriesEndgamePoints(rows, teamKey));
}

export function streakEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return streakValue(seriesEndgamePoints(rows, teamKey));
}

export function giniEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return gini(seriesEndgamePoints(rows, teamKey));
}

export function theilEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return theil(seriesEndgamePoints(rows, teamKey));
}

export function skewEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return quartileSkew(seriesEndgamePoints(rows, teamKey));
}

export function rangeEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return rangeWidth(seriesEndgamePoints(rows, teamKey));
}

export function madMeanEndgamePoints(rows: readonly SampleRow[], teamKey: string): number | null {
  return meanAbsDev(seriesEndgamePoints(rows, teamKey));
}

export function packEndgamePoints(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): WideMetricPack {
  const series = seriesEndgamePoints(rows, teamKey);
  return {
    id: "endgamePoints" as LovatMetricId,
    label: "Endgame points",
    series,
    stat: wideStat(series),
    shrink: shrinkEndgamePoints(rows, teamKey, fieldRows),
    forecast: forecastEndgamePoints(rows, teamKey),
    fit: fitEndgamePoints(rows, teamKey),
    control: controlEndgamePoints(rows, teamKey),
    slots: slotsEndgamePoints(rows, teamKey),
  };
}

export function describeEndgamePoints(pack: WideMetricPack): string {
  if (pack.stat.n === 0) return `Endgame points · Needs setup`;
  return `Endgame points · ${formatWideStat(pack.stat)} · forecast ${formatValue(pack.forecast, 1)}`;
}

export function slot0Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[0] ?? null;
}

export function slot0Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot0Value(values), populationMean(values), populationStdDev(values));
}

export function slot0Share(values: readonly number[]): number | null {
  const value = slot0Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot0Label(): string {
  return slotLabel(0);
}

export function slot0Ready(values: readonly number[]): boolean {
  return slot0Value(values) != null;
}

export function slot0Row(values: readonly number[]): SlotSlice {
  return {
    index: 0,
    label: slot0Label(),
    n: slot0Ready(values) ? 1 : 0,
    mean: slot0Value(values),
    tone: slot0Compare(values).tone,
  };
}

export function slot1Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[1] ?? null;
}

export function slot1Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot1Value(values), populationMean(values), populationStdDev(values));
}

export function slot1Share(values: readonly number[]): number | null {
  const value = slot1Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot1Label(): string {
  return slotLabel(1);
}

export function slot1Ready(values: readonly number[]): boolean {
  return slot1Value(values) != null;
}

export function slot1Row(values: readonly number[]): SlotSlice {
  return {
    index: 1,
    label: slot1Label(),
    n: slot1Ready(values) ? 1 : 0,
    mean: slot1Value(values),
    tone: slot1Compare(values).tone,
  };
}

export function slot2Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[2] ?? null;
}

export function slot2Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot2Value(values), populationMean(values), populationStdDev(values));
}

export function slot2Share(values: readonly number[]): number | null {
  const value = slot2Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot2Label(): string {
  return slotLabel(2);
}

export function slot2Ready(values: readonly number[]): boolean {
  return slot2Value(values) != null;
}

export function slot2Row(values: readonly number[]): SlotSlice {
  return {
    index: 2,
    label: slot2Label(),
    n: slot2Ready(values) ? 1 : 0,
    mean: slot2Value(values),
    tone: slot2Compare(values).tone,
  };
}

export function slot3Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[3] ?? null;
}

export function slot3Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot3Value(values), populationMean(values), populationStdDev(values));
}

export function slot3Share(values: readonly number[]): number | null {
  const value = slot3Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot3Label(): string {
  return slotLabel(3);
}

export function slot3Ready(values: readonly number[]): boolean {
  return slot3Value(values) != null;
}

export function slot3Row(values: readonly number[]): SlotSlice {
  return {
    index: 3,
    label: slot3Label(),
    n: slot3Ready(values) ? 1 : 0,
    mean: slot3Value(values),
    tone: slot3Compare(values).tone,
  };
}

export function slot4Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[4] ?? null;
}

export function slot4Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot4Value(values), populationMean(values), populationStdDev(values));
}

export function slot4Share(values: readonly number[]): number | null {
  const value = slot4Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot4Label(): string {
  return slotLabel(4);
}

export function slot4Ready(values: readonly number[]): boolean {
  return slot4Value(values) != null;
}

export function slot4Row(values: readonly number[]): SlotSlice {
  return {
    index: 4,
    label: slot4Label(),
    n: slot4Ready(values) ? 1 : 0,
    mean: slot4Value(values),
    tone: slot4Compare(values).tone,
  };
}

export function slot5Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[5] ?? null;
}

export function slot5Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot5Value(values), populationMean(values), populationStdDev(values));
}

export function slot5Share(values: readonly number[]): number | null {
  const value = slot5Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot5Label(): string {
  return slotLabel(5);
}

export function slot5Ready(values: readonly number[]): boolean {
  return slot5Value(values) != null;
}

export function slot5Row(values: readonly number[]): SlotSlice {
  return {
    index: 5,
    label: slot5Label(),
    n: slot5Ready(values) ? 1 : 0,
    mean: slot5Value(values),
    tone: slot5Compare(values).tone,
  };
}

export function slot6Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[6] ?? null;
}

export function slot6Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot6Value(values), populationMean(values), populationStdDev(values));
}

export function slot6Share(values: readonly number[]): number | null {
  const value = slot6Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot6Label(): string {
  return slotLabel(6);
}

export function slot6Ready(values: readonly number[]): boolean {
  return slot6Value(values) != null;
}

export function slot6Row(values: readonly number[]): SlotSlice {
  return {
    index: 6,
    label: slot6Label(),
    n: slot6Ready(values) ? 1 : 0,
    mean: slot6Value(values),
    tone: slot6Compare(values).tone,
  };
}

export function slot7Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[7] ?? null;
}

export function slot7Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot7Value(values), populationMean(values), populationStdDev(values));
}

export function slot7Share(values: readonly number[]): number | null {
  const value = slot7Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot7Label(): string {
  return slotLabel(7);
}

export function slot7Ready(values: readonly number[]): boolean {
  return slot7Value(values) != null;
}

export function slot7Row(values: readonly number[]): SlotSlice {
  return {
    index: 7,
    label: slot7Label(),
    n: slot7Ready(values) ? 1 : 0,
    mean: slot7Value(values),
    tone: slot7Compare(values).tone,
  };
}

export function slot8Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[8] ?? null;
}

export function slot8Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot8Value(values), populationMean(values), populationStdDev(values));
}

export function slot8Share(values: readonly number[]): number | null {
  const value = slot8Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot8Label(): string {
  return slotLabel(8);
}

export function slot8Ready(values: readonly number[]): boolean {
  return slot8Value(values) != null;
}

export function slot8Row(values: readonly number[]): SlotSlice {
  return {
    index: 8,
    label: slot8Label(),
    n: slot8Ready(values) ? 1 : 0,
    mean: slot8Value(values),
    tone: slot8Compare(values).tone,
  };
}

export function slot9Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[9] ?? null;
}

export function slot9Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot9Value(values), populationMean(values), populationStdDev(values));
}

export function slot9Share(values: readonly number[]): number | null {
  const value = slot9Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot9Label(): string {
  return slotLabel(9);
}

export function slot9Ready(values: readonly number[]): boolean {
  return slot9Value(values) != null;
}

export function slot9Row(values: readonly number[]): SlotSlice {
  return {
    index: 9,
    label: slot9Label(),
    n: slot9Ready(values) ? 1 : 0,
    mean: slot9Value(values),
    tone: slot9Compare(values).tone,
  };
}

export function slot10Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[10] ?? null;
}

export function slot10Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot10Value(values), populationMean(values), populationStdDev(values));
}

export function slot10Share(values: readonly number[]): number | null {
  const value = slot10Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot10Label(): string {
  return slotLabel(10);
}

export function slot10Ready(values: readonly number[]): boolean {
  return slot10Value(values) != null;
}

export function slot10Row(values: readonly number[]): SlotSlice {
  return {
    index: 10,
    label: slot10Label(),
    n: slot10Ready(values) ? 1 : 0,
    mean: slot10Value(values),
    tone: slot10Compare(values).tone,
  };
}

export function slot11Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[11] ?? null;
}

export function slot11Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot11Value(values), populationMean(values), populationStdDev(values));
}

export function slot11Share(values: readonly number[]): number | null {
  const value = slot11Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot11Label(): string {
  return slotLabel(11);
}

export function slot11Ready(values: readonly number[]): boolean {
  return slot11Value(values) != null;
}

export function slot11Row(values: readonly number[]): SlotSlice {
  return {
    index: 11,
    label: slot11Label(),
    n: slot11Ready(values) ? 1 : 0,
    mean: slot11Value(values),
    tone: slot11Compare(values).tone,
  };
}

export function slot12Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[12] ?? null;
}

export function slot12Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot12Value(values), populationMean(values), populationStdDev(values));
}

export function slot12Share(values: readonly number[]): number | null {
  const value = slot12Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot12Label(): string {
  return slotLabel(12);
}

export function slot12Ready(values: readonly number[]): boolean {
  return slot12Value(values) != null;
}

export function slot12Row(values: readonly number[]): SlotSlice {
  return {
    index: 12,
    label: slot12Label(),
    n: slot12Ready(values) ? 1 : 0,
    mean: slot12Value(values),
    tone: slot12Compare(values).tone,
  };
}

export function slot13Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[13] ?? null;
}

export function slot13Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot13Value(values), populationMean(values), populationStdDev(values));
}

export function slot13Share(values: readonly number[]): number | null {
  const value = slot13Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot13Label(): string {
  return slotLabel(13);
}

export function slot13Ready(values: readonly number[]): boolean {
  return slot13Value(values) != null;
}

export function slot13Row(values: readonly number[]): SlotSlice {
  return {
    index: 13,
    label: slot13Label(),
    n: slot13Ready(values) ? 1 : 0,
    mean: slot13Value(values),
    tone: slot13Compare(values).tone,
  };
}

export function slot14Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[14] ?? null;
}

export function slot14Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot14Value(values), populationMean(values), populationStdDev(values));
}

export function slot14Share(values: readonly number[]): number | null {
  const value = slot14Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot14Label(): string {
  return slotLabel(14);
}

export function slot14Ready(values: readonly number[]): boolean {
  return slot14Value(values) != null;
}

export function slot14Row(values: readonly number[]): SlotSlice {
  return {
    index: 14,
    label: slot14Label(),
    n: slot14Ready(values) ? 1 : 0,
    mean: slot14Value(values),
    tone: slot14Compare(values).tone,
  };
}

export function slot15Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[15] ?? null;
}

export function slot15Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot15Value(values), populationMean(values), populationStdDev(values));
}

export function slot15Share(values: readonly number[]): number | null {
  const value = slot15Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot15Label(): string {
  return slotLabel(15);
}

export function slot15Ready(values: readonly number[]): boolean {
  return slot15Value(values) != null;
}

export function slot15Row(values: readonly number[]): SlotSlice {
  return {
    index: 15,
    label: slot15Label(),
    n: slot15Ready(values) ? 1 : 0,
    mean: slot15Value(values),
    tone: slot15Compare(values).tone,
  };
}

export function slot16Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[16] ?? null;
}

export function slot16Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot16Value(values), populationMean(values), populationStdDev(values));
}

export function slot16Share(values: readonly number[]): number | null {
  const value = slot16Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot16Label(): string {
  return slotLabel(16);
}

export function slot16Ready(values: readonly number[]): boolean {
  return slot16Value(values) != null;
}

export function slot16Row(values: readonly number[]): SlotSlice {
  return {
    index: 16,
    label: slot16Label(),
    n: slot16Ready(values) ? 1 : 0,
    mean: slot16Value(values),
    tone: slot16Compare(values).tone,
  };
}

export function slot17Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[17] ?? null;
}

export function slot17Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot17Value(values), populationMean(values), populationStdDev(values));
}

export function slot17Share(values: readonly number[]): number | null {
  const value = slot17Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot17Label(): string {
  return slotLabel(17);
}

export function slot17Ready(values: readonly number[]): boolean {
  return slot17Value(values) != null;
}

export function slot17Row(values: readonly number[]): SlotSlice {
  return {
    index: 17,
    label: slot17Label(),
    n: slot17Ready(values) ? 1 : 0,
    mean: slot17Value(values),
    tone: slot17Compare(values).tone,
  };
}

export function slot18Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[18] ?? null;
}

export function slot18Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot18Value(values), populationMean(values), populationStdDev(values));
}

export function slot18Share(values: readonly number[]): number | null {
  const value = slot18Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot18Label(): string {
  return slotLabel(18);
}

export function slot18Ready(values: readonly number[]): boolean {
  return slot18Value(values) != null;
}

export function slot18Row(values: readonly number[]): SlotSlice {
  return {
    index: 18,
    label: slot18Label(),
    n: slot18Ready(values) ? 1 : 0,
    mean: slot18Value(values),
    tone: slot18Compare(values).tone,
  };
}

export function slot19Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[19] ?? null;
}

export function slot19Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot19Value(values), populationMean(values), populationStdDev(values));
}

export function slot19Share(values: readonly number[]): number | null {
  const value = slot19Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot19Label(): string {
  return slotLabel(19);
}

export function slot19Ready(values: readonly number[]): boolean {
  return slot19Value(values) != null;
}

export function slot19Row(values: readonly number[]): SlotSlice {
  return {
    index: 19,
    label: slot19Label(),
    n: slot19Ready(values) ? 1 : 0,
    mean: slot19Value(values),
    tone: slot19Compare(values).tone,
  };
}

export function slot20Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[20] ?? null;
}

export function slot20Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot20Value(values), populationMean(values), populationStdDev(values));
}

export function slot20Share(values: readonly number[]): number | null {
  const value = slot20Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot20Label(): string {
  return slotLabel(20);
}

export function slot20Ready(values: readonly number[]): boolean {
  return slot20Value(values) != null;
}

export function slot20Row(values: readonly number[]): SlotSlice {
  return {
    index: 20,
    label: slot20Label(),
    n: slot20Ready(values) ? 1 : 0,
    mean: slot20Value(values),
    tone: slot20Compare(values).tone,
  };
}

export function slot21Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[21] ?? null;
}

export function slot21Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot21Value(values), populationMean(values), populationStdDev(values));
}

export function slot21Share(values: readonly number[]): number | null {
  const value = slot21Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot21Label(): string {
  return slotLabel(21);
}

export function slot21Ready(values: readonly number[]): boolean {
  return slot21Value(values) != null;
}

export function slot21Row(values: readonly number[]): SlotSlice {
  return {
    index: 21,
    label: slot21Label(),
    n: slot21Ready(values) ? 1 : 0,
    mean: slot21Value(values),
    tone: slot21Compare(values).tone,
  };
}

export function slot22Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[22] ?? null;
}

export function slot22Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot22Value(values), populationMean(values), populationStdDev(values));
}

export function slot22Share(values: readonly number[]): number | null {
  const value = slot22Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot22Label(): string {
  return slotLabel(22);
}

export function slot22Ready(values: readonly number[]): boolean {
  return slot22Value(values) != null;
}

export function slot22Row(values: readonly number[]): SlotSlice {
  return {
    index: 22,
    label: slot22Label(),
    n: slot22Ready(values) ? 1 : 0,
    mean: slot22Value(values),
    tone: slot22Compare(values).tone,
  };
}

export function slot23Value(values: readonly number[]): number | null {
  const clean = cleanFinite(values);
  return clean[23] ?? null;
}

export function slot23Compare(values: readonly number[]): FieldCompare {
  return fieldCompare(slot23Value(values), populationMean(values), populationStdDev(values));
}

export function slot23Share(values: readonly number[]): number | null {
  const value = slot23Value(values);
  const mean = populationMean(values);
  return contributionShare(value, mean);
}

export function slot23Label(): string {
  return slotLabel(23);
}

export function slot23Ready(values: readonly number[]): boolean {
  return slot23Value(values) != null;
}

export function slot23Row(values: readonly number[]): SlotSlice {
  return {
    index: 23,
    label: slot23Label(),
    n: slot23Ready(values) ? 1 : 0,
    mean: slot23Value(values),
    tone: slot23Compare(values).tone,
  };
}

export function scoutLeadAgreement(values: readonly number[]): number | null {
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(0, 0 + half);
  return scouterAgreement(left, right.length ? right : values.slice(half));
}

export function scoutLeadFill(values: readonly number[]): number | null {
  const slice = values.slice(0, 0 + Math.max(1, Math.ceil(values.length / 2)));
  if (slice.length === 0) return null;
  return slice.filter((value) => Number.isFinite(value)).length / slice.length;
}

export function scoutLeadSlice(values: readonly number[]): ScoutSlice {
  return {
    key: "lead",
    label: scoutLabel("lead"),
    agreement: scoutLeadAgreement(values),
    filled: scoutLeadFill(values),
  };
}

export function scoutStandAgreement(values: readonly number[]): number | null {
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(1, 1 + half);
  return scouterAgreement(left, right.length ? right : values.slice(half));
}

export function scoutStandFill(values: readonly number[]): number | null {
  const slice = values.slice(1, 1 + Math.max(1, Math.ceil(values.length / 2)));
  if (slice.length === 0) return null;
  return slice.filter((value) => Number.isFinite(value)).length / slice.length;
}

export function scoutStandSlice(values: readonly number[]): ScoutSlice {
  return {
    key: "stand",
    label: scoutLabel("stand"),
    agreement: scoutStandAgreement(values),
    filled: scoutStandFill(values),
  };
}

export function scoutPitAgreement(values: readonly number[]): number | null {
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(2, 2 + half);
  return scouterAgreement(left, right.length ? right : values.slice(half));
}

export function scoutPitFill(values: readonly number[]): number | null {
  const slice = values.slice(2, 2 + Math.max(1, Math.ceil(values.length / 2)));
  if (slice.length === 0) return null;
  return slice.filter((value) => Number.isFinite(value)).length / slice.length;
}

export function scoutPitSlice(values: readonly number[]): ScoutSlice {
  return {
    key: "pit",
    label: scoutLabel("pit"),
    agreement: scoutPitAgreement(values),
    filled: scoutPitFill(values),
  };
}

export function scoutDriveAgreement(values: readonly number[]): number | null {
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(3, 3 + half);
  return scouterAgreement(left, right.length ? right : values.slice(half));
}

export function scoutDriveFill(values: readonly number[]): number | null {
  const slice = values.slice(3, 3 + Math.max(1, Math.ceil(values.length / 2)));
  if (slice.length === 0) return null;
  return slice.filter((value) => Number.isFinite(value)).length / slice.length;
}

export function scoutDriveSlice(values: readonly number[]): ScoutSlice {
  return {
    key: "drive",
    label: scoutLabel("drive"),
    agreement: scoutDriveAgreement(values),
    filled: scoutDriveFill(values),
  };
}

export function scoutAllianceAgreement(values: readonly number[]): number | null {
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(4, 4 + half);
  return scouterAgreement(left, right.length ? right : values.slice(half));
}

export function scoutAllianceFill(values: readonly number[]): number | null {
  const slice = values.slice(4, 4 + Math.max(1, Math.ceil(values.length / 2)));
  if (slice.length === 0) return null;
  return slice.filter((value) => Number.isFinite(value)).length / slice.length;
}

export function scoutAllianceSlice(values: readonly number[]): ScoutSlice {
  return {
    key: "alliance",
    label: scoutLabel("alliance"),
    agreement: scoutAllianceAgreement(values),
    filled: scoutAllianceFill(values),
  };
}

export function scoutReplayAgreement(values: readonly number[]): number | null {
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(5, 5 + half);
  return scouterAgreement(left, right.length ? right : values.slice(half));
}

export function scoutReplayFill(values: readonly number[]): number | null {
  const slice = values.slice(5, 5 + Math.max(1, Math.ceil(values.length / 2)));
  if (slice.length === 0) return null;
  return slice.filter((value) => Number.isFinite(value)).length / slice.length;
}

export function scoutReplaySlice(values: readonly number[]): ScoutSlice {
  return {
    key: "replay",
    label: scoutLabel("replay"),
    agreement: scoutReplayAgreement(values),
    filled: scoutReplayFill(values),
  };
}

export function scoutSecondAgreement(values: readonly number[]): number | null {
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(6, 6 + half);
  return scouterAgreement(left, right.length ? right : values.slice(half));
}

export function scoutSecondFill(values: readonly number[]): number | null {
  const slice = values.slice(6, 6 + Math.max(1, Math.ceil(values.length / 2)));
  if (slice.length === 0) return null;
  return slice.filter((value) => Number.isFinite(value)).length / slice.length;
}

export function scoutSecondSlice(values: readonly number[]): ScoutSlice {
  return {
    key: "second",
    label: scoutLabel("second"),
    agreement: scoutSecondAgreement(values),
    filled: scoutSecondFill(values),
  };
}

export function scoutAuditAgreement(values: readonly number[]): number | null {
  const half = Math.ceil(values.length / 2);
  const left = values.slice(0, half);
  const right = values.slice(7, 7 + half);
  return scouterAgreement(left, right.length ? right : values.slice(half));
}

export function scoutAuditFill(values: readonly number[]): number | null {
  const slice = values.slice(7, 7 + Math.max(1, Math.ceil(values.length / 2)));
  if (slice.length === 0) return null;
  return slice.filter((value) => Number.isFinite(value)).length / slice.length;
}

export function scoutAuditSlice(values: readonly number[]): ScoutSlice {
  return {
    key: "audit",
    label: scoutLabel("audit"),
    agreement: scoutAuditAgreement(values),
    filled: scoutAuditFill(values),
  };
}

export function rollEndgameClimb2(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 2);
}

export function rollEndgameClimb2Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb2(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb2Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb2(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb2Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb2Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb2(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb2Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 2: Needs setup";
  return "Endgame climb" + " last 2: " + formatValue(last, 1);
}

export function rollEndgameClimb3(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 3);
}

export function rollEndgameClimb3Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb3(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb3Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb3(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb3Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb3Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb3(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb3Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 3: Needs setup";
  return "Endgame climb" + " last 3: " + formatValue(last, 1);
}

export function rollEndgameClimb4(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 4);
}

export function rollEndgameClimb4Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb4(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb4Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb4(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb4Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb4Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb4(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb4Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 4: Needs setup";
  return "Endgame climb" + " last 4: " + formatValue(last, 1);
}

export function rollEndgameClimb5(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 5);
}

export function rollEndgameClimb5Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb5(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb5Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb5(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb5Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb5Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb5(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb5Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 5: Needs setup";
  return "Endgame climb" + " last 5: " + formatValue(last, 1);
}

export function rollEndgameClimb6(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 6);
}

export function rollEndgameClimb6Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb6(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb6Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb6(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb6Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb6Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb6(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb6Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 6: Needs setup";
  return "Endgame climb" + " last 6: " + formatValue(last, 1);
}

export function rollEndgameClimb7(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 7);
}

export function rollEndgameClimb7Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb7(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb7Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb7(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb7Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb7Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb7(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb7Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 7: Needs setup";
  return "Endgame climb" + " last 7: " + formatValue(last, 1);
}

export function rollEndgameClimb8(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 8);
}

export function rollEndgameClimb8Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb8(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb8Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb8(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb8Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb8Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb8(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb8Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 8: Needs setup";
  return "Endgame climb" + " last 8: " + formatValue(last, 1);
}

export function rollEndgameClimb9(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 9);
}

export function rollEndgameClimb9Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb9(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb9Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb9(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb9Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb9Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb9(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb9Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 9: Needs setup";
  return "Endgame climb" + " last 9: " + formatValue(last, 1);
}

export function rollEndgameClimb10(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 10);
}

export function rollEndgameClimb10Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb10(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb10Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb10(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb10Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb10Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb10(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb10Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 10: Needs setup";
  return "Endgame climb" + " last 10: " + formatValue(last, 1);
}

export function rollEndgameClimb12(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 12);
}

export function rollEndgameClimb12Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb12(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb12Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb12(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb12Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb12Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb12(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb12Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 12: Needs setup";
  return "Endgame climb" + " last 12: " + formatValue(last, 1);
}

export function rollEndgameClimb14(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 14);
}

export function rollEndgameClimb14Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb14(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb14Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb14(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb14Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb14Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb14(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb14Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 14: Needs setup";
  return "Endgame climb" + " last 14: " + formatValue(last, 1);
}

export function rollEndgameClimb16(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 16);
}

export function rollEndgameClimb16Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb16(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb16Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb16(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb16Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb16Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb16(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb16Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 16: Needs setup";
  return "Endgame climb" + " last 16: " + formatValue(last, 1);
}

export function rollEndgameClimb18(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 18);
}

export function rollEndgameClimb18Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb18(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb18Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb18(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb18Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb18Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb18(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb18Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 18: Needs setup";
  return "Endgame climb" + " last 18: " + formatValue(last, 1);
}

export function rollEndgameClimb20(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 20);
}

export function rollEndgameClimb20Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb20(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb20Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb20(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb20Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb20Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb20(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb20Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 20: Needs setup";
  return "Endgame climb" + " last 20: " + formatValue(last, 1);
}

export function rollEndgameClimb22(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 22);
}

export function rollEndgameClimb22Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb22(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb22Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb22(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb22Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb22Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb22(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb22Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 22: Needs setup";
  return "Endgame climb" + " last 22: " + formatValue(last, 1);
}

export function rollEndgameClimb24(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 24);
}

export function rollEndgameClimb24Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb24(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb24Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb24(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb24Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb24Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb24(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb24Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 24: Needs setup";
  return "Endgame climb" + " last 24: " + formatValue(last, 1);
}

export function rollEndgameClimb28(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 28);
}

export function rollEndgameClimb28Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb28(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb28Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb28(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb28Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb28Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb28(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb28Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 28: Needs setup";
  return "Endgame climb" + " last 28: " + formatValue(last, 1);
}

export function rollEndgameClimb32(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgameClimb(rows, teamKey), 32);
}

export function rollEndgameClimb32Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb32(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgameClimb32Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgameClimb32(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgameClimb32Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgameClimb32Last(rows, teamKey) != null;
}

export function describeRollEndgameClimb32(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgameClimb32Last(rows, teamKey);
  if (last == null) return "Endgame climb" + " last 32: Needs setup";
  return "Endgame climb" + " last 32: " + formatValue(last, 1);
}

export function rollTowerLevel2(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 2);
}

export function rollTowerLevel2Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel2(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel2Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel2(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel2Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel2Last(rows, teamKey) != null;
}

export function describeRollTowerLevel2(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel2Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 2: Needs setup";
  return "Tower level" + " last 2: " + formatValue(last, 1);
}

export function rollTowerLevel3(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 3);
}

export function rollTowerLevel3Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel3(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel3Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel3(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel3Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel3Last(rows, teamKey) != null;
}

export function describeRollTowerLevel3(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel3Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 3: Needs setup";
  return "Tower level" + " last 3: " + formatValue(last, 1);
}

export function rollTowerLevel4(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 4);
}

export function rollTowerLevel4Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel4(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel4Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel4(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel4Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel4Last(rows, teamKey) != null;
}

export function describeRollTowerLevel4(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel4Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 4: Needs setup";
  return "Tower level" + " last 4: " + formatValue(last, 1);
}

export function rollTowerLevel5(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 5);
}

export function rollTowerLevel5Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel5(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel5Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel5(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel5Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel5Last(rows, teamKey) != null;
}

export function describeRollTowerLevel5(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel5Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 5: Needs setup";
  return "Tower level" + " last 5: " + formatValue(last, 1);
}

export function rollTowerLevel6(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 6);
}

export function rollTowerLevel6Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel6(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel6Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel6(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel6Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel6Last(rows, teamKey) != null;
}

export function describeRollTowerLevel6(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel6Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 6: Needs setup";
  return "Tower level" + " last 6: " + formatValue(last, 1);
}

export function rollTowerLevel7(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 7);
}

export function rollTowerLevel7Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel7(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel7Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel7(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel7Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel7Last(rows, teamKey) != null;
}

export function describeRollTowerLevel7(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel7Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 7: Needs setup";
  return "Tower level" + " last 7: " + formatValue(last, 1);
}

export function rollTowerLevel8(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 8);
}

export function rollTowerLevel8Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel8(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel8Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel8(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel8Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel8Last(rows, teamKey) != null;
}

export function describeRollTowerLevel8(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel8Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 8: Needs setup";
  return "Tower level" + " last 8: " + formatValue(last, 1);
}

export function rollTowerLevel9(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 9);
}

export function rollTowerLevel9Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel9(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel9Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel9(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel9Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel9Last(rows, teamKey) != null;
}

export function describeRollTowerLevel9(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel9Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 9: Needs setup";
  return "Tower level" + " last 9: " + formatValue(last, 1);
}

export function rollTowerLevel10(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 10);
}

export function rollTowerLevel10Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel10(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel10Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel10(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel10Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel10Last(rows, teamKey) != null;
}

export function describeRollTowerLevel10(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel10Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 10: Needs setup";
  return "Tower level" + " last 10: " + formatValue(last, 1);
}

export function rollTowerLevel12(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 12);
}

export function rollTowerLevel12Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel12(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel12Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel12(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel12Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel12Last(rows, teamKey) != null;
}

export function describeRollTowerLevel12(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel12Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 12: Needs setup";
  return "Tower level" + " last 12: " + formatValue(last, 1);
}

export function rollTowerLevel14(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 14);
}

export function rollTowerLevel14Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel14(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel14Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel14(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel14Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel14Last(rows, teamKey) != null;
}

export function describeRollTowerLevel14(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel14Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 14: Needs setup";
  return "Tower level" + " last 14: " + formatValue(last, 1);
}

export function rollTowerLevel16(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 16);
}

export function rollTowerLevel16Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel16(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel16Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel16(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel16Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel16Last(rows, teamKey) != null;
}

export function describeRollTowerLevel16(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel16Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 16: Needs setup";
  return "Tower level" + " last 16: " + formatValue(last, 1);
}

export function rollTowerLevel18(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 18);
}

export function rollTowerLevel18Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel18(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel18Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel18(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel18Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel18Last(rows, teamKey) != null;
}

export function describeRollTowerLevel18(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel18Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 18: Needs setup";
  return "Tower level" + " last 18: " + formatValue(last, 1);
}

export function rollTowerLevel20(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 20);
}

export function rollTowerLevel20Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel20(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel20Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel20(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel20Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel20Last(rows, teamKey) != null;
}

export function describeRollTowerLevel20(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel20Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 20: Needs setup";
  return "Tower level" + " last 20: " + formatValue(last, 1);
}

export function rollTowerLevel22(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 22);
}

export function rollTowerLevel22Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel22(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel22Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel22(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel22Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel22Last(rows, teamKey) != null;
}

export function describeRollTowerLevel22(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel22Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 22: Needs setup";
  return "Tower level" + " last 22: " + formatValue(last, 1);
}

export function rollTowerLevel24(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 24);
}

export function rollTowerLevel24Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel24(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel24Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel24(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel24Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel24Last(rows, teamKey) != null;
}

export function describeRollTowerLevel24(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel24Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 24: Needs setup";
  return "Tower level" + " last 24: " + formatValue(last, 1);
}

export function rollTowerLevel28(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 28);
}

export function rollTowerLevel28Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel28(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel28Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel28(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel28Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel28Last(rows, teamKey) != null;
}

export function describeRollTowerLevel28(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel28Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 28: Needs setup";
  return "Tower level" + " last 28: " + formatValue(last, 1);
}

export function rollTowerLevel32(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesTowerLevel(rows, teamKey), 32);
}

export function rollTowerLevel32Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel32(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollTowerLevel32Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollTowerLevel32(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollTowerLevel32Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollTowerLevel32Last(rows, teamKey) != null;
}

export function describeRollTowerLevel32(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollTowerLevel32Last(rows, teamKey);
  if (last == null) return "Tower level" + " last 32: Needs setup";
  return "Tower level" + " last 32: " + formatValue(last, 1);
}

export function rollPark2(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 2);
}

export function rollPark2Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark2(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark2Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark2(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark2Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark2Last(rows, teamKey) != null;
}

export function describeRollPark2(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark2Last(rows, teamKey);
  if (last == null) return "Park" + " last 2: Needs setup";
  return "Park" + " last 2: " + formatValue(last, 1);
}

export function rollPark3(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 3);
}

export function rollPark3Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark3(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark3Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark3(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark3Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark3Last(rows, teamKey) != null;
}

export function describeRollPark3(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark3Last(rows, teamKey);
  if (last == null) return "Park" + " last 3: Needs setup";
  return "Park" + " last 3: " + formatValue(last, 1);
}

export function rollPark4(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 4);
}

export function rollPark4Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark4(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark4Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark4(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark4Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark4Last(rows, teamKey) != null;
}

export function describeRollPark4(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark4Last(rows, teamKey);
  if (last == null) return "Park" + " last 4: Needs setup";
  return "Park" + " last 4: " + formatValue(last, 1);
}

export function rollPark5(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 5);
}

export function rollPark5Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark5(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark5Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark5(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark5Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark5Last(rows, teamKey) != null;
}

export function describeRollPark5(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark5Last(rows, teamKey);
  if (last == null) return "Park" + " last 5: Needs setup";
  return "Park" + " last 5: " + formatValue(last, 1);
}

export function rollPark6(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 6);
}

export function rollPark6Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark6(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark6Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark6(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark6Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark6Last(rows, teamKey) != null;
}

export function describeRollPark6(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark6Last(rows, teamKey);
  if (last == null) return "Park" + " last 6: Needs setup";
  return "Park" + " last 6: " + formatValue(last, 1);
}

export function rollPark7(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 7);
}

export function rollPark7Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark7(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark7Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark7(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark7Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark7Last(rows, teamKey) != null;
}

export function describeRollPark7(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark7Last(rows, teamKey);
  if (last == null) return "Park" + " last 7: Needs setup";
  return "Park" + " last 7: " + formatValue(last, 1);
}

export function rollPark8(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 8);
}

export function rollPark8Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark8(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark8Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark8(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark8Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark8Last(rows, teamKey) != null;
}

export function describeRollPark8(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark8Last(rows, teamKey);
  if (last == null) return "Park" + " last 8: Needs setup";
  return "Park" + " last 8: " + formatValue(last, 1);
}

export function rollPark9(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 9);
}

export function rollPark9Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark9(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark9Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark9(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark9Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark9Last(rows, teamKey) != null;
}

export function describeRollPark9(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark9Last(rows, teamKey);
  if (last == null) return "Park" + " last 9: Needs setup";
  return "Park" + " last 9: " + formatValue(last, 1);
}

export function rollPark10(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 10);
}

export function rollPark10Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark10(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark10Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark10(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark10Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark10Last(rows, teamKey) != null;
}

export function describeRollPark10(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark10Last(rows, teamKey);
  if (last == null) return "Park" + " last 10: Needs setup";
  return "Park" + " last 10: " + formatValue(last, 1);
}

export function rollPark12(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 12);
}

export function rollPark12Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark12(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark12Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark12(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark12Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark12Last(rows, teamKey) != null;
}

export function describeRollPark12(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark12Last(rows, teamKey);
  if (last == null) return "Park" + " last 12: Needs setup";
  return "Park" + " last 12: " + formatValue(last, 1);
}

export function rollPark14(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 14);
}

export function rollPark14Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark14(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark14Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark14(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark14Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark14Last(rows, teamKey) != null;
}

export function describeRollPark14(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark14Last(rows, teamKey);
  if (last == null) return "Park" + " last 14: Needs setup";
  return "Park" + " last 14: " + formatValue(last, 1);
}

export function rollPark16(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 16);
}

export function rollPark16Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark16(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark16Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark16(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark16Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark16Last(rows, teamKey) != null;
}

export function describeRollPark16(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark16Last(rows, teamKey);
  if (last == null) return "Park" + " last 16: Needs setup";
  return "Park" + " last 16: " + formatValue(last, 1);
}

export function rollPark18(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 18);
}

export function rollPark18Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark18(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark18Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark18(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark18Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark18Last(rows, teamKey) != null;
}

export function describeRollPark18(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark18Last(rows, teamKey);
  if (last == null) return "Park" + " last 18: Needs setup";
  return "Park" + " last 18: " + formatValue(last, 1);
}

export function rollPark20(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 20);
}

export function rollPark20Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark20(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark20Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark20(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark20Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark20Last(rows, teamKey) != null;
}

export function describeRollPark20(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark20Last(rows, teamKey);
  if (last == null) return "Park" + " last 20: Needs setup";
  return "Park" + " last 20: " + formatValue(last, 1);
}

export function rollPark22(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 22);
}

export function rollPark22Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark22(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark22Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark22(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark22Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark22Last(rows, teamKey) != null;
}

export function describeRollPark22(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark22Last(rows, teamKey);
  if (last == null) return "Park" + " last 22: Needs setup";
  return "Park" + " last 22: " + formatValue(last, 1);
}

export function rollPark24(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 24);
}

export function rollPark24Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark24(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark24Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark24(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark24Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark24Last(rows, teamKey) != null;
}

export function describeRollPark24(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark24Last(rows, teamKey);
  if (last == null) return "Park" + " last 24: Needs setup";
  return "Park" + " last 24: " + formatValue(last, 1);
}

export function rollPark28(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 28);
}

export function rollPark28Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark28(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark28Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark28(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark28Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark28Last(rows, teamKey) != null;
}

export function describeRollPark28(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark28Last(rows, teamKey);
  if (last == null) return "Park" + " last 28: Needs setup";
  return "Park" + " last 28: " + formatValue(last, 1);
}

export function rollPark32(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesPark(rows, teamKey), 32);
}

export function rollPark32Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark32(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollPark32Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollPark32(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollPark32Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollPark32Last(rows, teamKey) != null;
}

export function describeRollPark32(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollPark32Last(rows, teamKey);
  if (last == null) return "Park" + " last 32: Needs setup";
  return "Park" + " last 32: " + formatValue(last, 1);
}

export function rollEndgamePoints2(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 2);
}

export function rollEndgamePoints2Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints2(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints2Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints2(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints2Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints2Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints2(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints2Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 2: Needs setup";
  return "Endgame points" + " last 2: " + formatValue(last, 1);
}

export function rollEndgamePoints3(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 3);
}

export function rollEndgamePoints3Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints3(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints3Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints3(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints3Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints3Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints3(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints3Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 3: Needs setup";
  return "Endgame points" + " last 3: " + formatValue(last, 1);
}

export function rollEndgamePoints4(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 4);
}

export function rollEndgamePoints4Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints4(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints4Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints4(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints4Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints4Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints4(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints4Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 4: Needs setup";
  return "Endgame points" + " last 4: " + formatValue(last, 1);
}

export function rollEndgamePoints5(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 5);
}

export function rollEndgamePoints5Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints5(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints5Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints5(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints5Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints5Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints5(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints5Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 5: Needs setup";
  return "Endgame points" + " last 5: " + formatValue(last, 1);
}

export function rollEndgamePoints6(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 6);
}

export function rollEndgamePoints6Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints6(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints6Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints6(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints6Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints6Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints6(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints6Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 6: Needs setup";
  return "Endgame points" + " last 6: " + formatValue(last, 1);
}

export function rollEndgamePoints7(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 7);
}

export function rollEndgamePoints7Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints7(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints7Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints7(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints7Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints7Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints7(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints7Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 7: Needs setup";
  return "Endgame points" + " last 7: " + formatValue(last, 1);
}

export function rollEndgamePoints8(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 8);
}

export function rollEndgamePoints8Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints8(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints8Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints8(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints8Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints8Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints8(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints8Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 8: Needs setup";
  return "Endgame points" + " last 8: " + formatValue(last, 1);
}

export function rollEndgamePoints9(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 9);
}

export function rollEndgamePoints9Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints9(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints9Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints9(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints9Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints9Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints9(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints9Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 9: Needs setup";
  return "Endgame points" + " last 9: " + formatValue(last, 1);
}

export function rollEndgamePoints10(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 10);
}

export function rollEndgamePoints10Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints10(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints10Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints10(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints10Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints10Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints10(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints10Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 10: Needs setup";
  return "Endgame points" + " last 10: " + formatValue(last, 1);
}

export function rollEndgamePoints12(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 12);
}

export function rollEndgamePoints12Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints12(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints12Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints12(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints12Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints12Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints12(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints12Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 12: Needs setup";
  return "Endgame points" + " last 12: " + formatValue(last, 1);
}

export function rollEndgamePoints14(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 14);
}

export function rollEndgamePoints14Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints14(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints14Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints14(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints14Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints14Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints14(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints14Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 14: Needs setup";
  return "Endgame points" + " last 14: " + formatValue(last, 1);
}

export function rollEndgamePoints16(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 16);
}

export function rollEndgamePoints16Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints16(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints16Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints16(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints16Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints16Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints16(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints16Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 16: Needs setup";
  return "Endgame points" + " last 16: " + formatValue(last, 1);
}

export function rollEndgamePoints18(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 18);
}

export function rollEndgamePoints18Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints18(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints18Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints18(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints18Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints18Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints18(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints18Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 18: Needs setup";
  return "Endgame points" + " last 18: " + formatValue(last, 1);
}

export function rollEndgamePoints20(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 20);
}

export function rollEndgamePoints20Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints20(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints20Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints20(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints20Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints20Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints20(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints20Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 20: Needs setup";
  return "Endgame points" + " last 20: " + formatValue(last, 1);
}

export function rollEndgamePoints22(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 22);
}

export function rollEndgamePoints22Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints22(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints22Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints22(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints22Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints22Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints22(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints22Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 22: Needs setup";
  return "Endgame points" + " last 22: " + formatValue(last, 1);
}

export function rollEndgamePoints24(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 24);
}

export function rollEndgamePoints24Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints24(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints24Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints24(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints24Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints24Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints24(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints24Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 24: Needs setup";
  return "Endgame points" + " last 24: " + formatValue(last, 1);
}

export function rollEndgamePoints28(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 28);
}

export function rollEndgamePoints28Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints28(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints28Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints28(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints28Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints28Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints28(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints28Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 28: Needs setup";
  return "Endgame points" + " last 28: " + formatValue(last, 1);
}

export function rollEndgamePoints32(rows: readonly SampleRow[], teamKey: string): Array<number | null> {
  return rollingMean(seriesEndgamePoints(rows, teamKey), 32);
}

export function rollEndgamePoints32Last(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints32(rows, teamKey);
  const last = series[series.length - 1];
  return last == null ? null : last;
}

export function rollEndgamePoints32Delta(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = rollEndgamePoints32(rows, teamKey);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last == null || prev == null) return null;
  return last - prev;
}

export function rollEndgamePoints32Ready(rows: readonly SampleRow[], teamKey: string): boolean {
  return rollEndgamePoints32Last(rows, teamKey) != null;
}

export function describeRollEndgamePoints32(rows: readonly SampleRow[], teamKey: string): string {
  const last = rollEndgamePoints32Last(rows, teamKey);
  if (last == null) return "Endgame points" + " last 32: Needs setup";
  return "Endgame points" + " last 32: " + formatValue(last, 1);
}

export function buildWideReport(input: { teamKey: string; rows: readonly SampleRow[]; fieldRows?: readonly SampleRow[] }): WideReport {
  const packs: WideMetricPack[] = [
    packEndgameClimb(input.rows, input.teamKey, input.fieldRows),
    packTowerLevel(input.rows, input.teamKey, input.fieldRows),
    packPark(input.rows, input.teamKey, input.fieldRows),
    packEndgamePoints(input.rows, input.teamKey, input.fieldRows)
  ];
  const lead = packs[0];
  const series = lead?.series ?? [];
  const known = packs.filter((pack) => pack.stat.n > 0).length;
  return {
    slug: SLUG,
    packs,
    scouts: scoutSlices(series),
    slots: slotSlices(series),
    quality: dataQuality(input.rows),
    headline: known === 0 ? `Needs setup · ${PHASE_LABEL}` : `${known} rating${known === 1 ? "" : "s"} · wide board · ${WINDOW_LABEL}`,
  };
}

export function wideReasons(report: WideReport): string[] {
  const reasons: string[] = [];
  for (const pack of report.packs) {
    if (pack.stat.n === 0) reasons.push(`${pack.label} needs a real scout row`);
  }
  if (report.scouts.every((slice) => slice.agreement == null)) reasons.push("No second-pass agreement yet");
  if (report.slots.every((slot) => slot.mean == null)) reasons.push("No match slots filled yet");
  return reasons;
}

export function wideSections(report: WideReport): Array<{ id: string; title: string; body: string }> {
  return [
    { id: "head", title: studentChrome().event, body: report.headline },
    { id: "quality", title: "Scout fill", body: qualityLabel(report.quality) },
    ...report.packs.map((pack) => ({ id: pack.id, title: pack.label, body: describeWidePack(pack) })),
  ];
}

export function describeWidePack(pack: WideMetricPack): string {
  if (pack.stat.n === 0) return "Needs setup";
  return formatWideStat(pack.stat);
}

export function emptyWideCopy(): { badge: string; title: string; description: string } {
  const empty = emptyCopy();
  return {
    ...empty,
    description: `${empty.description} Wide board (Hodges–Lehmann, Theil–Sen, match slots, scout agreement) stays blank too.`,
  };
}

export type LovatExactSource = "event" | "scout";
export type LovatExactId =
  | "totalPoints" | "autoPoints" | "teleopPoints" | "endgameClimb" | "rank" | "wins"
  | "opr" | "dpr" | "ccwm" | "driverAbility" | "autoClimb" | "defenseEffectiveness"
  | "contactDefenseTime" | "campingDefenseTime" | "totalDefenseTime" | "totalFuelThroughput"
  | "totalFuelFed" | "feedingRate" | "scoringRate" | "estimatedSuccessfulFuelRate"
  | "estimatedTotalFuelScored" | "reliability";

export type LovatExactDef = { id: LovatExactId; label: string; source: LovatExactSource; invert: boolean };
export const LOVAT_EXACT_METRICS: readonly LovatExactDef[] = [
  {
    "id": "totalPoints",
    "label": "Total points",
    "source": "event",
    "invert": false
  },
  {
    "id": "autoPoints",
    "label": "Auto points",
    "source": "event",
    "invert": false
  },
  {
    "id": "teleopPoints",
    "label": "Teleop points",
    "source": "event",
    "invert": false
  },
  {
    "id": "endgameClimb",
    "label": "Endgame climb",
    "source": "event",
    "invert": false
  },
  {
    "id": "rank",
    "label": "Rank",
    "source": "event",
    "invert": true
  },
  {
    "id": "wins",
    "label": "Wins",
    "source": "event",
    "invert": false
  },
  {
    "id": "opr",
    "label": "Offensive rating",
    "source": "event",
    "invert": false
  },
  {
    "id": "dpr",
    "label": "Defensive rating",
    "source": "event",
    "invert": true
  },
  {
    "id": "ccwm",
    "label": "Winning margin",
    "source": "event",
    "invert": false
  },
  {
    "id": "driverAbility",
    "label": "Driver ability",
    "source": "scout",
    "invert": false
  },
  {
    "id": "autoClimb",
    "label": "Auto climb",
    "source": "scout",
    "invert": false
  },
  {
    "id": "defenseEffectiveness",
    "label": "Defense effectiveness",
    "source": "scout",
    "invert": false
  },
  {
    "id": "contactDefenseTime",
    "label": "Contact defense time",
    "source": "scout",
    "invert": false
  },
  {
    "id": "campingDefenseTime",
    "label": "Camping defense time",
    "source": "scout",
    "invert": false
  },
  {
    "id": "totalDefenseTime",
    "label": "Total defensive time",
    "source": "scout",
    "invert": false
  },
  {
    "id": "totalFuelThroughput",
    "label": "Total fuel throughput",
    "source": "scout",
    "invert": false
  },
  {
    "id": "totalFuelFed",
    "label": "Total fuel fed",
    "source": "scout",
    "invert": false
  },
  {
    "id": "feedingRate",
    "label": "Feeding rate",
    "source": "scout",
    "invert": false
  },
  {
    "id": "scoringRate",
    "label": "Scoring rate",
    "source": "scout",
    "invert": false
  },
  {
    "id": "estimatedSuccessfulFuelRate",
    "label": "Successful fuel rate",
    "source": "scout",
    "invert": false
  },
  {
    "id": "estimatedTotalFuelScored",
    "label": "Estimated fuel scored",
    "source": "scout",
    "invert": false
  },
  {
    "id": "reliability",
    "label": "Reliability",
    "source": "scout",
    "invert": false
  }
] as const;
export const LOVAT_NEAR_Z = 0.38;

export type LovatExactCard = {
  id: LovatExactId;
  label: string;
  source: LovatExactSource;
  value: number | null;
  display: string;
  compare: FieldCompare;
  contribution: number | null;
  sparkline: string | null;
  sample: number;
  detail: string;
};

export function exactValue(row: SampleRow, id: LovatExactId): number | null {
  const wide = row.values as Record<string, unknown>;
  return asNumber(wide[id] ?? wide[id === "totalPoints" ? METRICS[0]!.id : id]);
}

export function exactField(rows: readonly SampleRow[], id: LovatExactId): FieldStat | null {
  const values = windowRows(rows).map((row) => exactValue(row, id)).filter((value): value is number => value != null);
  const mean = populationMean(values);
  const std = populationStdDev(values);
  if (mean == null || std == null) return null;
  return { mean, std, n: values.length };
}

/** Lovat lookup compare: near-band 0.38, invert rank/DPR, never invent a zero. */
export function lovatExactCompare(value: number | null, mean: number | null, std: number | null, invert = false): FieldCompare {
  if (value == null || mean == null || !Number.isFinite(value) || !Number.isFinite(mean)) {
    return { tone: "unknown", label: "Need two teams at this event", delta: null, z: null };
  }
  const delta = invert ? mean - value : value - mean;
  const z = zScore(invert ? mean : value, invert ? value : mean, std);
  const magnitude = z != null ? Math.abs(z) : Math.abs(delta) / Math.max(1, Math.abs(mean));
  if (magnitude < LOVAT_NEAR_Z) return { tone: "near", label: "Near this event", delta, z };
  if (delta > 0) return { tone: "above", label: "Above this event", delta, z };
  return { tone: "below", label: "Below this event", delta, z };
}

export function lovatExactContribution(value: number | null, mean: number | null): number | null {
  if (value == null || mean == null || mean === 0) return null;
  return Math.round((value / mean) * 1000) / 1000;
}

export function lovatErf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-abs * abs);
  return sign * y;
}

export function lovatPhi(z: number): number {
  if (!Number.isFinite(z)) return Number.NaN;
  return 0.5 * (1 + lovatErf(z / Math.SQRT2));
}

export function lovatAllianceSpread(teams: ReadonlyArray<{ mean: number; std: number }>): { mean: number; std: number } | null {
  if (teams.length === 0) return null;
  for (const team of teams) {
    if (!Number.isFinite(team.mean) || !Number.isFinite(team.std) || team.std < 0) return null;
  }
  const mean = teams.reduce((sum, team) => sum + team.mean, 0);
  const variance = teams.reduce((sum, team) => sum + team.std * team.std, 0);
  return { mean: Math.round(mean * 100) / 100, std: Math.round(Math.sqrt(variance) * 10000) / 10000 };
}

/** Lovat Match Predictor: P(blue) = Φ((0 - (red−blue)) / σ_diff). */
export function lovatExactWin(red: { mean: number; std: number }, blue: { mean: number; std: number }): {
  redPredicted: number;
  bluePredicted: number;
  redWinPct: number;
  blueWinPct: number;
} | null {
  const diff = red.mean - blue.mean;
  const std = Math.sqrt(red.std * red.std + blue.std * blue.std);
  if (!Number.isFinite(std) || std <= 0) return null;
  const blueWinPct = Math.round(lovatPhi((0 - diff) / std) * 10000) / 10000;
  if (!Number.isFinite(blueWinPct)) return null;
  return {
    redPredicted: Math.round(red.mean * 100) / 100,
    bluePredicted: Math.round(blue.mean * 100) / 100,
    redWinPct: Math.round((1 - blueWinPct) * 10000) / 10000,
    blueWinPct,
  };
}

export function lovatExactWinFromMargin(margin: number | null, std: number | null): number | null {
  if (margin == null || std == null || std <= 0) return null;
  return clamp(lovatPhi(margin / std), 0.02, 0.98);
}

export function improveWinWithRecency(
  red: ReadonlyArray<{ mean: number; std: number; ewma?: number | null }>,
  blue: ReadonlyArray<{ mean: number; std: number; ewma?: number | null }>,
): ReturnType<typeof lovatExactWin> {
  const blend = (rows: ReadonlyArray<{ mean: number; std: number; ewma?: number | null }>) =>
    rows.map((row) => ({ mean: row.ewma != null ? 0.6 * row.ewma + 0.4 * row.mean : row.mean, std: row.std }));
  const left = lovatAllianceSpread(blend(red));
  const right = lovatAllianceSpread(blend(blue));
  if (!left || !right) return null;
  return lovatExactWin(left, right);
}

export function flipAllianceWin(pred: NonNullable<ReturnType<typeof lovatExactWin>>): NonNullable<ReturnType<typeof lovatExactWin>> {
  return {
    redPredicted: pred.bluePredicted,
    bluePredicted: pred.redPredicted,
    redWinPct: pred.blueWinPct,
    blueWinPct: pred.redWinPct,
  };
}

export type LovatSliderId = LovatExactId;
export function lovatDefaultSliders(): Record<LovatSliderId, number> {
  const out = {} as Record<LovatSliderId, number>;
  for (const metric of LOVAT_EXACT_METRICS) {
    out[metric.id] = metric.invert ? 0.55 : metric.source === "event" ? 1 : 0.85;
  }
  return out;
}

/** Lovat picklist: weighted sum of event z-scores. Missing metric → skip, never 0-fill. */
export function lovatPickScore(cards: readonly LovatExactCard[], sliders: Partial<Record<LovatSliderId, number>>): number | null {
  let total = 0;
  let weight = 0;
  for (const card of cards) {
    if (card.compare.z == null) continue;
    const w = sliders[card.id] ?? 0;
    if (w <= 0) continue;
    total += card.compare.z * w;
    weight += w;
  }
  if (weight === 0) return null;
  return Math.round((total / weight) * 1000) / 1000;
}

export function improvePickWithLocks(
  cards: readonly LovatExactCard[],
  sliders: Partial<Record<LovatSliderId, number>>,
  locks: Partial<Record<LovatSliderId, boolean>>,
): number | null {
  const next = { ...sliders };
  for (const metric of LOVAT_EXACT_METRICS) {
    if (locks[metric.id]) next[metric.id] = sliders[metric.id] ?? 1;
  }
  return lovatPickScore(cards, next);
}

export function lovatPlayhead(paths: readonly (readonly PathPoint[])[], t: number): Array<PathPoint | null> {
  return playheadSample(paths, t);
}

export function improvePlayheadConflicts(paths: readonly (readonly PathPoint[])[], t: number): Array<{ pair: [number, number]; distance: number }> {
  const samples = lovatPlayhead(paths, t);
  const hits: Array<{ pair: [number, number]; distance: number }> = [];
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      const a = samples[i];
      const b = samples[j];
      if (!a || !b) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < ROBOT_RADIUS_IN * 2) hits.push({ pair: [i, j], distance });
    }
  }
  return hits;
}

export type ContextPhase = "auto" | "teleop" | "endgame";
export function lovatVisibleWhen(phase: ContextPhase, key: string): boolean {
  if (phase === "auto") return key.startsWith("auto") || key === "leave" || key === "autoClimb";
  if (phase === "teleop") return !key.startsWith("auto") && key !== "endgameClimb" && key !== "park";
  return key === "endgameClimb" || key === "park" || key === "towerLevel";
}

export function improveContextRules(phase: ContextPhase, keys: readonly string[]): string[] {
  return keys.filter((key) => lovatVisibleWhen(phase, key));
}

export function lovatSourceMix(event: number | null, scout: number | null, scoutWeight = 0.45): number | null {
  if (event == null && scout == null) return null;
  if (event == null) return scout;
  if (scout == null) return event;
  return (1 - scoutWeight) * event + scoutWeight * scout;
}

export function improveSourceMix(event: number | null, scout: number | null, scoutN: number): number | null {
  const weight = clamp(scoutN / (scoutN + 4), 0, 0.7);
  return lovatSourceMix(event, scout, weight);
}


export const LOVAT_TOTALPOINTS_SOURCE: LovatExactSource = "event";
export const LOVAT_TOTALPOINTS_INVERT = false;

export function exactTotalPointsSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "totalPoints" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactTotalPointsValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactTotalPointsSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactTotalPointsCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactTotalPointsValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "totalPoints" as LovatExactId);
  const series = exactTotalPointsSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "totalPoints" as LovatExactId,
    label: "Total points",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactTotalPointsPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactTotalPointsCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function totalPointsEpaShare(value: number | null, alliance: readonly number[]): number | null {
  const sum = populationMean(alliance);
  if (value == null || sum == null || sum === 0) return null;
  return value / (sum * alliance.length);
}
export function totalPointsPhaseWeight(): number {
  return 0.20;
}
export function improveTotalPointsWithRecency(values: readonly number[]): number | null {
  const recent = ewmaSeries(values, 0.4);
  const trimmed = trimmedMean(values);
  if (recent == null) return trimmed;
  if (trimmed == null) return recent;
  return 0.65 * recent + 0.35 * trimmed;
}


export const LOVAT_AUTOPOINTS_SOURCE: LovatExactSource = "event";
export const LOVAT_AUTOPOINTS_INVERT = false;

export function exactAutoPointsSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "autoPoints" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactAutoPointsValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactAutoPointsSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactAutoPointsCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactAutoPointsValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "autoPoints" as LovatExactId);
  const series = exactAutoPointsSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "autoPoints" as LovatExactId,
    label: "Auto points",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactAutoPointsPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactAutoPointsCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function autoPointsEpaShare(value: number | null, alliance: readonly number[]): number | null {
  const sum = populationMean(alliance);
  if (value == null || sum == null || sum === 0) return null;
  return value / (sum * alliance.length);
}
export function autoPointsPhaseWeight(): number {
  return 0.22;
}
export function improveAutoPointsWithRecency(values: readonly number[]): number | null {
  const recent = ewmaSeries(values, 0.4);
  const trimmed = trimmedMean(values);
  if (recent == null) return trimmed;
  if (trimmed == null) return recent;
  return 0.65 * recent + 0.35 * trimmed;
}


export const LOVAT_TELEOPPOINTS_SOURCE: LovatExactSource = "event";
export const LOVAT_TELEOPPOINTS_INVERT = false;

export function exactTeleopPointsSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "teleopPoints" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactTeleopPointsValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactTeleopPointsSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactTeleopPointsCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactTeleopPointsValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "teleopPoints" as LovatExactId);
  const series = exactTeleopPointsSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "teleopPoints" as LovatExactId,
    label: "Teleop points",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactTeleopPointsPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactTeleopPointsCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function teleopPointsEpaShare(value: number | null, alliance: readonly number[]): number | null {
  const sum = populationMean(alliance);
  if (value == null || sum == null || sum === 0) return null;
  return value / (sum * alliance.length);
}
export function teleopPointsPhaseWeight(): number {
  return 0.58;
}
export function improveTeleopPointsWithRecency(values: readonly number[]): number | null {
  const recent = ewmaSeries(values, 0.4);
  const trimmed = trimmedMean(values);
  if (recent == null) return trimmed;
  if (trimmed == null) return recent;
  return 0.65 * recent + 0.35 * trimmed;
}


export const LOVAT_ENDGAMECLIMB_SOURCE: LovatExactSource = "event";
export const LOVAT_ENDGAMECLIMB_INVERT = false;

export function exactEndgameClimbSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "endgameClimb" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactEndgameClimbValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactEndgameClimbSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactEndgameClimbCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactEndgameClimbValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "endgameClimb" as LovatExactId);
  const series = exactEndgameClimbSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "endgameClimb" as LovatExactId,
    label: "Endgame climb",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactEndgameClimbPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactEndgameClimbCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function endgameClimbClimbPosterior(successes: number, attempts: number): number | null {
  return climbPosterior(successes, attempts, 1.5, 2.5);
}
export function endgameClimbClimbRisk(values: readonly number[]): number | null {
  const rate = reliabilityHazard(values);
  if (rate == null) return null;
  return clamp(1 - rate, 0, 1);
}
export function improveEndgameClimbParkVsClimb(climb: number | null, park: number | null): number | null {
  if (climb == null && park == null) return null;
  return (climb ?? 0) * 0.85 + (park ?? 0) * 0.15;
}


export const LOVAT_RANK_SOURCE: LovatExactSource = "event";
export const LOVAT_RANK_INVERT = true;

export function exactRankSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "rank" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactRankValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactRankSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactRankCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactRankValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "rank" as LovatExactId);
  const series = exactRankSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, true);
  return {
    id: "rank" as LovatExactId,
    label: "Rank",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: true ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactRankPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactRankCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function rankInvert(value: number | null, fieldN: number): number | null {
  if (value == null || fieldN <= 0) return null;
  return (fieldN + 1 - value) / fieldN;
}
export function improveRankPercentile(value: number | null, field: readonly number[]): number | null {
  if (value == null || field.length === 0) return null;
  const better = field.filter((item) => item < value).length;
  return better / field.length;
}


export const LOVAT_WINS_SOURCE: LovatExactSource = "event";
export const LOVAT_WINS_INVERT = false;

export function exactWinsSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "wins" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactWinsValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactWinsSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactWinsCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactWinsValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "wins" as LovatExactId);
  const series = exactWinsSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "wins" as LovatExactId,
    label: "Wins",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactWinsPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactWinsCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function winsWinRate(wins: number | null, matches: number): number | null {
  if (wins == null || matches <= 0) return null;
  return clamp(wins / matches, 0, 1);
}
export function improveWinsWilson(wins: number, matches: number): { lo: number; hi: number } | null {
  return wilsonInterval(wins, matches);
}


export const LOVAT_OPR_SOURCE: LovatExactSource = "event";
export const LOVAT_OPR_INVERT = false;

export function exactOprSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "opr" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactOprValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactOprSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactOprCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactOprValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "opr" as LovatExactId);
  const series = exactOprSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "opr" as LovatExactId,
    label: "Offensive rating",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactOprPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactOprCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function oprVsCcwm(opr: number | null, ccwm: number | null): number | null {
  if (opr == null || ccwm == null) return null;
  return opr - ccwm;
}
export function improveOprShrunk(opr: number | null, field: number | null, n: number): number | null {
  return shrinkTowardField(opr, field, n, 6);
}


export const LOVAT_DPR_SOURCE: LovatExactSource = "event";
export const LOVAT_DPR_INVERT = true;

export function exactDprSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "dpr" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactDprValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactDprSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactDprCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactDprValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "dpr" as LovatExactId);
  const series = exactDprSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, true);
  return {
    id: "dpr" as LovatExactId,
    label: "Defensive rating",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: true ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactDprPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactDprCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function dprPressure(dpr: number | null, defenseTime: number | null): number | null {
  if (dpr == null) return null;
  if (defenseTime == null) return dpr;
  return dpr * (1 + clamp(defenseTime / 40, 0, 0.35));
}
export function improveDprInvertZ(dpr: number | null, mean: number | null, std: number | null): number | null {
  return zScore(mean, dpr, std);
}


export const LOVAT_CCWM_SOURCE: LovatExactSource = "event";
export const LOVAT_CCWM_INVERT = false;

export function exactCcwmSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "ccwm" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactCcwmValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactCcwmSeries(rows, teamKey);
  if (series.length === 0) return null;
  return trimmedMean(series);
}

export function exactCcwmCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactCcwmValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "ccwm" as LovatExactId);
  const series = exactCcwmSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "ccwm" as LovatExactId,
    label: "Winning margin",
    source: "event",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Event rating vs this event",
  };
}

export function exactCcwmPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactCcwmCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function ccwmFromSides(opr: number | null, dpr: number | null): number | null {
  if (opr == null || dpr == null) return null;
  return opr - dpr;
}
export function improveCcwmMarginToWin(ccwm: number | null, fieldStd: number | null): number | null {
  return lovatExactWinFromMargin(ccwm, fieldStd);
}


export const LOVAT_DRIVERABILITY_SOURCE: LovatExactSource = "scout";
export const LOVAT_DRIVERABILITY_INVERT = false;

export function exactDriverAbilitySeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "driverAbility" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactDriverAbilityValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactDriverAbilitySeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactDriverAbilityCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactDriverAbilityValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "driverAbility" as LovatExactId);
  const series = exactDriverAbilitySeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "driverAbility" as LovatExactId,
    label: "Driver ability",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactDriverAbilityPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactDriverAbilityCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function driverAbilityPace(cycle: number | null, fouls: number | null): number | null {
  if (cycle == null) return null;
  const penalty = fouls == null ? 0 : clamp(fouls / 8, 0, 0.4);
  return cycle * (1 - penalty);
}
export function improveDriverAbilityClutch(values: readonly number[]): number | null {
  if (values.length < 3) return null;
  return ewmaSeries(values.slice(-3), 0.55);
}


export const LOVAT_AUTOCLIMB_SOURCE: LovatExactSource = "scout";
export const LOVAT_AUTOCLIMB_INVERT = false;

export function exactAutoClimbSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "autoClimb" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactAutoClimbValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactAutoClimbSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactAutoClimbCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactAutoClimbValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "autoClimb" as LovatExactId);
  const series = exactAutoClimbSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "autoClimb" as LovatExactId,
    label: "Auto climb",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactAutoClimbPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactAutoClimbCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function autoClimbClimbPosterior(successes: number, attempts: number): number | null {
  return climbPosterior(successes, attempts, 1.5, 2.5);
}
export function autoClimbClimbRisk(values: readonly number[]): number | null {
  const rate = reliabilityHazard(values);
  if (rate == null) return null;
  return clamp(1 - rate, 0, 1);
}
export function improveAutoClimbParkVsClimb(climb: number | null, park: number | null): number | null {
  if (climb == null && park == null) return null;
  return (climb ?? 0) * 0.85 + (park ?? 0) * 0.15;
}


export const LOVAT_DEFENSEEFFECTIVENESS_SOURCE: LovatExactSource = "scout";
export const LOVAT_DEFENSEEFFECTIVENESS_INVERT = false;

export function exactDefenseEffectivenessSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "defenseEffectiveness" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactDefenseEffectivenessValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactDefenseEffectivenessSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactDefenseEffectivenessCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactDefenseEffectivenessValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "defenseEffectiveness" as LovatExactId);
  const series = exactDefenseEffectivenessSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "defenseEffectiveness" as LovatExactId,
    label: "Defense effectiveness",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactDefenseEffectivenessPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactDefenseEffectivenessCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function defenseEffectivenessShareOfMatch(seconds: number | null, matchLen = 150): number | null {
  if (seconds == null || matchLen <= 0) return null;
  return clamp(seconds / matchLen, 0, 1);
}
export function improveDefenseEffectivenessTradeoff(defense: number | null, scoring: number | null): number | null {
  if (defense == null || scoring == null) return null;
  return scoring - defense * 0.35;
}


export const LOVAT_CONTACTDEFENSETIME_SOURCE: LovatExactSource = "scout";
export const LOVAT_CONTACTDEFENSETIME_INVERT = false;

export function exactContactDefenseTimeSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "contactDefenseTime" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactContactDefenseTimeValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactContactDefenseTimeSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactContactDefenseTimeCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactContactDefenseTimeValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "contactDefenseTime" as LovatExactId);
  const series = exactContactDefenseTimeSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "contactDefenseTime" as LovatExactId,
    label: "Contact defense time",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactContactDefenseTimePickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactContactDefenseTimeCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function contactDefenseTimeShareOfMatch(seconds: number | null, matchLen = 150): number | null {
  if (seconds == null || matchLen <= 0) return null;
  return clamp(seconds / matchLen, 0, 1);
}
export function improveContactDefenseTimeTradeoff(defense: number | null, scoring: number | null): number | null {
  if (defense == null || scoring == null) return null;
  return scoring - defense * 0.35;
}


export const LOVAT_CAMPINGDEFENSETIME_SOURCE: LovatExactSource = "scout";
export const LOVAT_CAMPINGDEFENSETIME_INVERT = false;

export function exactCampingDefenseTimeSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "campingDefenseTime" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactCampingDefenseTimeValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactCampingDefenseTimeSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactCampingDefenseTimeCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactCampingDefenseTimeValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "campingDefenseTime" as LovatExactId);
  const series = exactCampingDefenseTimeSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "campingDefenseTime" as LovatExactId,
    label: "Camping defense time",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactCampingDefenseTimePickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactCampingDefenseTimeCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function campingDefenseTimeShareOfMatch(seconds: number | null, matchLen = 150): number | null {
  if (seconds == null || matchLen <= 0) return null;
  return clamp(seconds / matchLen, 0, 1);
}
export function improveCampingDefenseTimeTradeoff(defense: number | null, scoring: number | null): number | null {
  if (defense == null || scoring == null) return null;
  return scoring - defense * 0.35;
}


export const LOVAT_TOTALDEFENSETIME_SOURCE: LovatExactSource = "scout";
export const LOVAT_TOTALDEFENSETIME_INVERT = false;

export function exactTotalDefenseTimeSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "totalDefenseTime" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactTotalDefenseTimeValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactTotalDefenseTimeSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactTotalDefenseTimeCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactTotalDefenseTimeValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "totalDefenseTime" as LovatExactId);
  const series = exactTotalDefenseTimeSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "totalDefenseTime" as LovatExactId,
    label: "Total defensive time",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactTotalDefenseTimePickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactTotalDefenseTimeCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function totalDefenseTimeShareOfMatch(seconds: number | null, matchLen = 150): number | null {
  if (seconds == null || matchLen <= 0) return null;
  return clamp(seconds / matchLen, 0, 1);
}
export function improveTotalDefenseTimeTradeoff(defense: number | null, scoring: number | null): number | null {
  if (defense == null || scoring == null) return null;
  return scoring - defense * 0.35;
}


export const LOVAT_TOTALFUELTHROUGHPUT_SOURCE: LovatExactSource = "scout";
export const LOVAT_TOTALFUELTHROUGHPUT_INVERT = false;

export function exactTotalFuelThroughputSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "totalFuelThroughput" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactTotalFuelThroughputValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactTotalFuelThroughputSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactTotalFuelThroughputCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactTotalFuelThroughputValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "totalFuelThroughput" as LovatExactId);
  const series = exactTotalFuelThroughputSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "totalFuelThroughput" as LovatExactId,
    label: "Total fuel throughput",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactTotalFuelThroughputPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactTotalFuelThroughputCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function totalFuelThroughputEfficiency(scored: number | null, fed: number | null): number | null {
  if (scored == null || fed == null || fed <= 0) return null;
  return clamp(scored / fed, 0, 1);
}
export function improveTotalFuelThroughputPoisson(rate: number | null, seconds: number): number | null {
  return expectedCycles(rate, seconds);
}


export const LOVAT_TOTALFUELFED_SOURCE: LovatExactSource = "scout";
export const LOVAT_TOTALFUELFED_INVERT = false;

export function exactTotalFuelFedSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "totalFuelFed" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactTotalFuelFedValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactTotalFuelFedSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactTotalFuelFedCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactTotalFuelFedValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "totalFuelFed" as LovatExactId);
  const series = exactTotalFuelFedSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "totalFuelFed" as LovatExactId,
    label: "Total fuel fed",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactTotalFuelFedPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactTotalFuelFedCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function totalFuelFedEfficiency(scored: number | null, fed: number | null): number | null {
  if (scored == null || fed == null || fed <= 0) return null;
  return clamp(scored / fed, 0, 1);
}
export function improveTotalFuelFedPoisson(rate: number | null, seconds: number): number | null {
  return expectedCycles(rate, seconds);
}


export const LOVAT_FEEDINGRATE_SOURCE: LovatExactSource = "scout";
export const LOVAT_FEEDINGRATE_INVERT = false;

export function exactFeedingRateSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "feedingRate" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactFeedingRateValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactFeedingRateSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactFeedingRateCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactFeedingRateValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "feedingRate" as LovatExactId);
  const series = exactFeedingRateSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "feedingRate" as LovatExactId,
    label: "Feeding rate",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactFeedingRatePickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactFeedingRateCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function feedingRateEfficiency(scored: number | null, fed: number | null): number | null {
  if (scored == null || fed == null || fed <= 0) return null;
  return clamp(scored / fed, 0, 1);
}
export function improveFeedingRatePoisson(rate: number | null, seconds: number): number | null {
  return expectedCycles(rate, seconds);
}


export const LOVAT_SCORINGRATE_SOURCE: LovatExactSource = "scout";
export const LOVAT_SCORINGRATE_INVERT = false;

export function exactScoringRateSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "scoringRate" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactScoringRateValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactScoringRateSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactScoringRateCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactScoringRateValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "scoringRate" as LovatExactId);
  const series = exactScoringRateSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "scoringRate" as LovatExactId,
    label: "Scoring rate",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactScoringRatePickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactScoringRateCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function scoringRateEfficiency(scored: number | null, fed: number | null): number | null {
  if (scored == null || fed == null || fed <= 0) return null;
  return clamp(scored / fed, 0, 1);
}
export function improveScoringRatePoisson(rate: number | null, seconds: number): number | null {
  return expectedCycles(rate, seconds);
}


export const LOVAT_ESTIMATEDSUCCESSFULFUELRATE_SOURCE: LovatExactSource = "scout";
export const LOVAT_ESTIMATEDSUCCESSFULFUELRATE_INVERT = false;

export function exactEstimatedSuccessfulFuelRateSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "estimatedSuccessfulFuelRate" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactEstimatedSuccessfulFuelRateValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactEstimatedSuccessfulFuelRateSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactEstimatedSuccessfulFuelRateCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactEstimatedSuccessfulFuelRateValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "estimatedSuccessfulFuelRate" as LovatExactId);
  const series = exactEstimatedSuccessfulFuelRateSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "estimatedSuccessfulFuelRate" as LovatExactId,
    label: "Successful fuel rate",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactEstimatedSuccessfulFuelRatePickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactEstimatedSuccessfulFuelRateCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function estimatedSuccessfulFuelRateEfficiency(scored: number | null, fed: number | null): number | null {
  if (scored == null || fed == null || fed <= 0) return null;
  return clamp(scored / fed, 0, 1);
}
export function improveEstimatedSuccessfulFuelRatePoisson(rate: number | null, seconds: number): number | null {
  return expectedCycles(rate, seconds);
}


export const LOVAT_ESTIMATEDTOTALFUELSCORED_SOURCE: LovatExactSource = "scout";
export const LOVAT_ESTIMATEDTOTALFUELSCORED_INVERT = false;

export function exactEstimatedTotalFuelScoredSeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "estimatedTotalFuelScored" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactEstimatedTotalFuelScoredValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactEstimatedTotalFuelScoredSeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactEstimatedTotalFuelScoredCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactEstimatedTotalFuelScoredValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "estimatedTotalFuelScored" as LovatExactId);
  const series = exactEstimatedTotalFuelScoredSeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "estimatedTotalFuelScored" as LovatExactId,
    label: "Estimated fuel scored",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactEstimatedTotalFuelScoredPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactEstimatedTotalFuelScoredCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function estimatedTotalFuelScoredEfficiency(scored: number | null, fed: number | null): number | null {
  if (scored == null || fed == null || fed <= 0) return null;
  return clamp(scored / fed, 0, 1);
}
export function improveEstimatedTotalFuelScoredPoisson(rate: number | null, seconds: number): number | null {
  return expectedCycles(rate, seconds);
}


export const LOVAT_RELIABILITY_SOURCE: LovatExactSource = "scout";
export const LOVAT_RELIABILITY_INVERT = false;

export function exactReliabilitySeries(rows: readonly SampleRow[], teamKey: string): number[] {
  return windowRows(rows)
    .filter((row) => uniqueTeamKey(row.teamKey) === uniqueTeamKey(teamKey))
    .map((row) => exactValue(row, "reliability" as LovatExactId))
    .filter((value): value is number => value != null);
}

export function exactReliabilityValue(rows: readonly SampleRow[], teamKey: string): number | null {
  const series = exactReliabilitySeries(rows, teamKey);
  if (series.length === 0) return null;
  return ewmaSeries(series);
}

export function exactReliabilityCard(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard {
  const value = exactReliabilityValue(rows, teamKey);
  const field = exactField(fieldRows ?? rows, "reliability" as LovatExactId);
  const series = exactReliabilitySeries(rows, teamKey);
  const compare = lovatExactCompare(value, field?.mean ?? null, field?.std ?? null, false);
  return {
    id: "reliability" as LovatExactId,
    label: "Reliability",
    source: "scout",
    value,
    display: formatValue(value),
    compare,
    contribution: false ? null : lovatExactContribution(value, field?.mean ?? null),
    sparkline: sparklinePath(series),
    sample: series.length,
    detail: value == null ? "Needs setup" : "Scout rating vs this event",
  };
}

export function exactReliabilityPickZ(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): number | null {
  const card = exactReliabilityCard(rows, teamKey, fieldRows);
  return card.compare.z;
}

export function reliabilityUptime(values: readonly number[]): number | null {
  const hazard = reliabilityHazard(values);
  if (hazard == null) return null;
  return clamp(1 - hazard, 0, 1);
}
export function improveReliabilityWeibull(values: readonly number[]): number | null {
  const mid = median(values);
  const scale = mad(values);
  if (mid == null || scale == null || scale === 0) return null;
  return clamp(Math.exp(-Math.pow(0.45 / Math.abs(mid / scale), 1.4)), 0, 1);
}



export function buildLovatExactCards(rows: readonly SampleRow[], teamKey: string, fieldRows?: readonly SampleRow[]): LovatExactCard[] {
  return [
    exactTotalPointsCard(rows, teamKey, fieldRows),
    exactAutoPointsCard(rows, teamKey, fieldRows),
    exactTeleopPointsCard(rows, teamKey, fieldRows),
    exactEndgameClimbCard(rows, teamKey, fieldRows),
    exactRankCard(rows, teamKey, fieldRows),
    exactWinsCard(rows, teamKey, fieldRows),
    exactOprCard(rows, teamKey, fieldRows),
    exactDprCard(rows, teamKey, fieldRows),
    exactCcwmCard(rows, teamKey, fieldRows),
    exactDriverAbilityCard(rows, teamKey, fieldRows),
    exactAutoClimbCard(rows, teamKey, fieldRows),
    exactDefenseEffectivenessCard(rows, teamKey, fieldRows),
    exactContactDefenseTimeCard(rows, teamKey, fieldRows),
    exactCampingDefenseTimeCard(rows, teamKey, fieldRows),
    exactTotalDefenseTimeCard(rows, teamKey, fieldRows),
    exactTotalFuelThroughputCard(rows, teamKey, fieldRows),
    exactTotalFuelFedCard(rows, teamKey, fieldRows),
    exactFeedingRateCard(rows, teamKey, fieldRows),
    exactScoringRateCard(rows, teamKey, fieldRows),
    exactEstimatedSuccessfulFuelRateCard(rows, teamKey, fieldRows),
    exactEstimatedTotalFuelScoredCard(rows, teamKey, fieldRows),
    exactReliabilityCard(rows, teamKey, fieldRows),
  ];
}

export type LovatExactReport = {
  slug: string;
  cards: LovatExactCard[];
  pick: number | null;
  win: ReturnType<typeof lovatExactWin>;
  visible: string[];
  headline: string;
};

export function buildLovatExactReport(input: { teamKey: string; rows: readonly SampleRow[]; fieldRows?: readonly SampleRow[] }): LovatExactReport {
  const cards = buildLovatExactCards(input.rows, input.teamKey, input.fieldRows);
  const known = cards.filter((card) => card.value != null).length;
  const mine = exactTotalPointsValue(input.rows, input.teamKey);
  const field = exactField(input.fieldRows ?? input.rows, "totalPoints");
  const self = mine == null || field == null ? null : { mean: mine, std: field.std };
  const opp = field == null ? null : { mean: field.mean, std: field.std };
  return {
    slug: SLUG,
    cards,
    pick: lovatPickScore(cards, lovatDefaultSliders()),
    win: self && opp ? lovatExactWin(self, opp) : null,
    visible: improveContextRules("endgame", LOVAT_EXACT_METRICS.map((metric) => metric.id)),
    headline: known === 0 ? `Needs setup · Lovat lookup` : `${known} Lovat ratings · ${WINDOW_LABEL}`,
  };
}

export function lovatExactReasons(report: LovatExactReport): string[] {
  return report.cards.filter((card) => card.value == null).map((card) => `${card.label} needs a real ${card.source} row`);
}


export type LovatPresetId = "offense" | "defense" | "auto" | "endgame" | "fuel" | "driver" | "balanced" | "captain" | "firstPick" | "secondPick" | "clutch" | "qualFocus" | "playoffFocus" | "scoutHeavy" | "eventHeavy";
export function lovatPresetSliders(id: LovatPresetId): Partial<Record<LovatSliderId, number>> {
  switch (id) {
    case "offense":
      return {"totalPoints":1.2,"opr":1.1,"scoringRate":1,"autoPoints":0.8,"dpr":0.2};
    case "defense":
      return {"dpr":1.2,"totalDefenseTime":1.1,"defenseEffectiveness":1,"contactDefenseTime":0.8,"opr":0.2};
    case "auto":
      return {"autoPoints":1.3,"autoClimb":0.9,"pathClear":0.4,"teleopPoints":0.4};
    case "endgame":
      return {"endgameClimb":1.3,"autoClimb":0.4,"teleopPoints":0.5,"reliability":0.7};
    case "fuel":
      return {"totalFuelThroughput":1.2,"estimatedTotalFuelScored":1.1,"feedingRate":0.9,"scoringRate":1};
    case "driver":
      return {"driverAbility":1.3,"scoringRate":0.8,"reliability":0.7,"wins":0.5};
    case "balanced":
      return {"totalPoints":1,"opr":0.8,"dpr":0.8,"reliability":0.8,"driverAbility":0.7};
    case "captain":
      return {"opr":1.2,"ccwm":1.1,"wins":0.9,"rank":0.8,"reliability":0.6};
    case "firstPick":
      return {"teleopPoints":1.2,"scoringRate":1,"totalFuelThroughput":0.8,"defenseEffectiveness":0.5};
    case "secondPick":
      return {"defenseEffectiveness":1.1,"totalDefenseTime":1,"reliability":0.9,"driverAbility":0.7};
    case "clutch":
      return {"ccwm":1.2,"reliability":1,"driverAbility":0.9,"endgameClimb":0.8};
    case "qualFocus":
      return {"wins":1,"rank":1,"opr":0.8,"totalPoints":0.8};
    case "playoffFocus":
      return {"ccwm":1.2,"endgameClimb":1,"reliability":1,"driverAbility":0.8};
    case "scoutHeavy":
      return {"driverAbility":1.2,"defenseEffectiveness":1,"scoringRate":1,"reliability":0.9};
    case "eventHeavy":
      return {"opr":1.2,"dpr":1,"ccwm":1,"rank":0.7,"wins":0.7};
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function pickPresetOffense(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("offense"));
}
export function describePresetOffense(cards: readonly LovatExactCard[]): string {
  const score = pickPresetOffense(cards);
  return score == null ? "offense" + " pick: Needs setup" : "offense" + " pick: " + formatValue(score, 2);
}

export function pickPresetDefense(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("defense"));
}
export function describePresetDefense(cards: readonly LovatExactCard[]): string {
  const score = pickPresetDefense(cards);
  return score == null ? "defense" + " pick: Needs setup" : "defense" + " pick: " + formatValue(score, 2);
}

export function pickPresetAuto(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("auto"));
}
export function describePresetAuto(cards: readonly LovatExactCard[]): string {
  const score = pickPresetAuto(cards);
  return score == null ? "auto" + " pick: Needs setup" : "auto" + " pick: " + formatValue(score, 2);
}

export function pickPresetEndgame(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("endgame"));
}
export function describePresetEndgame(cards: readonly LovatExactCard[]): string {
  const score = pickPresetEndgame(cards);
  return score == null ? "endgame" + " pick: Needs setup" : "endgame" + " pick: " + formatValue(score, 2);
}

export function pickPresetFuel(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("fuel"));
}
export function describePresetFuel(cards: readonly LovatExactCard[]): string {
  const score = pickPresetFuel(cards);
  return score == null ? "fuel" + " pick: Needs setup" : "fuel" + " pick: " + formatValue(score, 2);
}

export function pickPresetDriver(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("driver"));
}
export function describePresetDriver(cards: readonly LovatExactCard[]): string {
  const score = pickPresetDriver(cards);
  return score == null ? "driver" + " pick: Needs setup" : "driver" + " pick: " + formatValue(score, 2);
}

export function pickPresetBalanced(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("balanced"));
}
export function describePresetBalanced(cards: readonly LovatExactCard[]): string {
  const score = pickPresetBalanced(cards);
  return score == null ? "balanced" + " pick: Needs setup" : "balanced" + " pick: " + formatValue(score, 2);
}

export function pickPresetCaptain(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("captain"));
}
export function describePresetCaptain(cards: readonly LovatExactCard[]): string {
  const score = pickPresetCaptain(cards);
  return score == null ? "captain" + " pick: Needs setup" : "captain" + " pick: " + formatValue(score, 2);
}

export function pickPresetFirstPick(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("firstPick"));
}
export function describePresetFirstPick(cards: readonly LovatExactCard[]): string {
  const score = pickPresetFirstPick(cards);
  return score == null ? "firstPick" + " pick: Needs setup" : "firstPick" + " pick: " + formatValue(score, 2);
}

export function pickPresetSecondPick(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("secondPick"));
}
export function describePresetSecondPick(cards: readonly LovatExactCard[]): string {
  const score = pickPresetSecondPick(cards);
  return score == null ? "secondPick" + " pick: Needs setup" : "secondPick" + " pick: " + formatValue(score, 2);
}

export function pickPresetClutch(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("clutch"));
}
export function describePresetClutch(cards: readonly LovatExactCard[]): string {
  const score = pickPresetClutch(cards);
  return score == null ? "clutch" + " pick: Needs setup" : "clutch" + " pick: " + formatValue(score, 2);
}

export function pickPresetQualFocus(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("qualFocus"));
}
export function describePresetQualFocus(cards: readonly LovatExactCard[]): string {
  const score = pickPresetQualFocus(cards);
  return score == null ? "qualFocus" + " pick: Needs setup" : "qualFocus" + " pick: " + formatValue(score, 2);
}

export function pickPresetPlayoffFocus(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("playoffFocus"));
}
export function describePresetPlayoffFocus(cards: readonly LovatExactCard[]): string {
  const score = pickPresetPlayoffFocus(cards);
  return score == null ? "playoffFocus" + " pick: Needs setup" : "playoffFocus" + " pick: " + formatValue(score, 2);
}

export function pickPresetScoutHeavy(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("scoutHeavy"));
}
export function describePresetScoutHeavy(cards: readonly LovatExactCard[]): string {
  const score = pickPresetScoutHeavy(cards);
  return score == null ? "scoutHeavy" + " pick: Needs setup" : "scoutHeavy" + " pick: " + formatValue(score, 2);
}

export function pickPresetEventHeavy(cards: readonly LovatExactCard[]): number | null {
  return lovatPickScore(cards, lovatPresetSliders("eventHeavy"));
}
export function describePresetEventHeavy(cards: readonly LovatExactCard[]): string {
  const score = pickPresetEventHeavy(cards);
  return score == null ? "eventHeavy" + " pick: Needs setup" : "eventHeavy" + " pick: " + formatValue(score, 2);
}

export function mixTotalPoints(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixTotalPointsCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixTotalPoints(event, scout, scoutN), mean, std, false);
}
export function assignTotalPointsRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingTotalPointsSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixAutoPoints(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixAutoPointsCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixAutoPoints(event, scout, scoutN), mean, std, false);
}
export function assignAutoPointsRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingAutoPointsSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixTeleopPoints(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixTeleopPointsCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixTeleopPoints(event, scout, scoutN), mean, std, false);
}
export function assignTeleopPointsRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingTeleopPointsSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixEndgameClimb(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixEndgameClimbCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixEndgameClimb(event, scout, scoutN), mean, std, false);
}
export function assignEndgameClimbRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingEndgameClimbSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixRank(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixRankCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixRank(event, scout, scoutN), mean, std, true);
}
export function assignRankRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingRankSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixWins(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixWinsCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixWins(event, scout, scoutN), mean, std, false);
}
export function assignWinsRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingWinsSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixOpr(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixOprCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixOpr(event, scout, scoutN), mean, std, false);
}
export function assignOprRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingOprSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixDpr(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixDprCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixDpr(event, scout, scoutN), mean, std, true);
}
export function assignDprRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingDprSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixCcwm(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixCcwmCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixCcwm(event, scout, scoutN), mean, std, false);
}
export function assignCcwmRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingCcwmSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixDriverAbility(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixDriverAbilityCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixDriverAbility(event, scout, scoutN), mean, std, false);
}
export function assignDriverAbilityRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingDriverAbilitySchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixAutoClimb(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixAutoClimbCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixAutoClimb(event, scout, scoutN), mean, std, false);
}
export function assignAutoClimbRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingAutoClimbSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixDefenseEffectiveness(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixDefenseEffectivenessCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixDefenseEffectiveness(event, scout, scoutN), mean, std, false);
}
export function assignDefenseEffectivenessRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingDefenseEffectivenessSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixContactDefenseTime(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixContactDefenseTimeCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixContactDefenseTime(event, scout, scoutN), mean, std, false);
}
export function assignContactDefenseTimeRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingContactDefenseTimeSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixCampingDefenseTime(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixCampingDefenseTimeCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixCampingDefenseTime(event, scout, scoutN), mean, std, false);
}
export function assignCampingDefenseTimeRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingCampingDefenseTimeSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixTotalDefenseTime(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixTotalDefenseTimeCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixTotalDefenseTime(event, scout, scoutN), mean, std, false);
}
export function assignTotalDefenseTimeRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingTotalDefenseTimeSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixTotalFuelThroughput(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixTotalFuelThroughputCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixTotalFuelThroughput(event, scout, scoutN), mean, std, false);
}
export function assignTotalFuelThroughputRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingTotalFuelThroughputSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixTotalFuelFed(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixTotalFuelFedCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixTotalFuelFed(event, scout, scoutN), mean, std, false);
}
export function assignTotalFuelFedRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingTotalFuelFedSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixFeedingRate(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixFeedingRateCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixFeedingRate(event, scout, scoutN), mean, std, false);
}
export function assignFeedingRateRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingFeedingRateSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixScoringRate(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixScoringRateCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixScoringRate(event, scout, scoutN), mean, std, false);
}
export function assignScoringRateRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingScoringRateSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixEstimatedSuccessfulFuelRate(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixEstimatedSuccessfulFuelRateCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixEstimatedSuccessfulFuelRate(event, scout, scoutN), mean, std, false);
}
export function assignEstimatedSuccessfulFuelRateRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingEstimatedSuccessfulFuelRateSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixEstimatedTotalFuelScored(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixEstimatedTotalFuelScoredCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixEstimatedTotalFuelScored(event, scout, scoutN), mean, std, false);
}
export function assignEstimatedTotalFuelScoredRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingEstimatedTotalFuelScoredSchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function mixReliability(event: number | null, scout: number | null, scoutN: number): number | null {
  return improveSourceMix(event, scout, scoutN);
}
export function mixReliabilityCard(event: number | null, scout: number | null, scoutN: number, mean: number | null, std: number | null): FieldCompare {
  return lovatExactCompare(mixReliability(event, scout, scoutN), mean, std, false);
}
export function assignReliabilityRange(start: number, end: number, teamKeys: readonly string[]): Array<{ teamKey: string; slot: number }> {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return teamKeys.slice(lo, hi + 1).map((teamKey, index) => ({ teamKey, slot: lo + index }));
}
export function remainingReliabilitySchedule(values: readonly number[], left: number): number | null {
  const rate = forecastNext(values);
  if (rate == null || left <= 0) return null;
  return rate * left;
}

export function playheadT0(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 0);
}
export function conflictsT0(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 0);
}
export function clearT0(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT0(paths).length === 0;
}

export function playheadT0p5(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 0.5);
}
export function conflictsT0p5(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 0.5);
}
export function clearT0p5(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT0p5(paths).length === 0;
}

export function playheadT1(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 1);
}
export function conflictsT1(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 1);
}
export function clearT1(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT1(paths).length === 0;
}

export function playheadT1p5(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 1.5);
}
export function conflictsT1p5(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 1.5);
}
export function clearT1p5(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT1p5(paths).length === 0;
}

export function playheadT2(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 2);
}
export function conflictsT2(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 2);
}
export function clearT2(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT2(paths).length === 0;
}

export function playheadT3(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 3);
}
export function conflictsT3(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 3);
}
export function clearT3(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT3(paths).length === 0;
}

export function playheadT4(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 4);
}
export function conflictsT4(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 4);
}
export function clearT4(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT4(paths).length === 0;
}

export function playheadT5(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 5);
}
export function conflictsT5(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 5);
}
export function clearT5(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT5(paths).length === 0;
}

export function playheadT6(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 6);
}
export function conflictsT6(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 6);
}
export function clearT6(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT6(paths).length === 0;
}

export function playheadT8(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 8);
}
export function conflictsT8(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 8);
}
export function clearT8(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT8(paths).length === 0;
}

export function playheadT10(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 10);
}
export function conflictsT10(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 10);
}
export function clearT10(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT10(paths).length === 0;
}

export function playheadT12(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 12);
}
export function conflictsT12(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 12);
}
export function clearT12(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT12(paths).length === 0;
}

export function playheadT14(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 14);
}
export function conflictsT14(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 14);
}
export function clearT14(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT14(paths).length === 0;
}

export function playheadT15(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 15);
}
export function conflictsT15(paths: readonly (readonly PathPoint[])[]): Array<{ pair: [number, number]; distance: number }> {
  return improvePlayheadConflicts(paths, 15);
}
export function clearT15(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.every((path) => path.length < 2)) return null;
  return conflictsT15(paths).length === 0;
}

export function tick0s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 0);
}
export function tick0sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 0).length;
}
export function tick0sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick0sHits(paths) === 0;
}

export function tick0p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 0.2);
}
export function tick0p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 0.2).length;
}
export function tick0p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick0p2sHits(paths) === 0;
}

export function tick0p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 0.4);
}
export function tick0p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 0.4).length;
}
export function tick0p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick0p4sHits(paths) === 0;
}

export function tick0p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 0.6);
}
export function tick0p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 0.6).length;
}
export function tick0p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick0p6sHits(paths) === 0;
}

export function tick0p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 0.8);
}
export function tick0p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 0.8).length;
}
export function tick0p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick0p8sHits(paths) === 0;
}

export function tick1s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 1);
}
export function tick1sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 1).length;
}
export function tick1sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick1sHits(paths) === 0;
}

export function tick1p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 1.2);
}
export function tick1p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 1.2).length;
}
export function tick1p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick1p2sHits(paths) === 0;
}

export function tick1p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 1.4);
}
export function tick1p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 1.4).length;
}
export function tick1p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick1p4sHits(paths) === 0;
}

export function tick1p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 1.6);
}
export function tick1p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 1.6).length;
}
export function tick1p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick1p6sHits(paths) === 0;
}

export function tick1p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 1.8);
}
export function tick1p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 1.8).length;
}
export function tick1p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick1p8sHits(paths) === 0;
}

export function tick2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 2);
}
export function tick2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 2).length;
}
export function tick2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick2sHits(paths) === 0;
}

export function tick2p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 2.2);
}
export function tick2p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 2.2).length;
}
export function tick2p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick2p2sHits(paths) === 0;
}

export function tick2p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 2.4);
}
export function tick2p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 2.4).length;
}
export function tick2p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick2p4sHits(paths) === 0;
}

export function tick2p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 2.6);
}
export function tick2p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 2.6).length;
}
export function tick2p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick2p6sHits(paths) === 0;
}

export function tick2p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 2.8);
}
export function tick2p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 2.8).length;
}
export function tick2p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick2p8sHits(paths) === 0;
}

export function tick3s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 3);
}
export function tick3sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 3).length;
}
export function tick3sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick3sHits(paths) === 0;
}

export function tick3p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 3.2);
}
export function tick3p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 3.2).length;
}
export function tick3p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick3p2sHits(paths) === 0;
}

export function tick3p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 3.4);
}
export function tick3p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 3.4).length;
}
export function tick3p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick3p4sHits(paths) === 0;
}

export function tick3p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 3.6);
}
export function tick3p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 3.6).length;
}
export function tick3p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick3p6sHits(paths) === 0;
}

export function tick3p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 3.8);
}
export function tick3p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 3.8).length;
}
export function tick3p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick3p8sHits(paths) === 0;
}

export function tick4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 4);
}
export function tick4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 4).length;
}
export function tick4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick4sHits(paths) === 0;
}

export function tick4p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 4.2);
}
export function tick4p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 4.2).length;
}
export function tick4p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick4p2sHits(paths) === 0;
}

export function tick4p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 4.4);
}
export function tick4p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 4.4).length;
}
export function tick4p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick4p4sHits(paths) === 0;
}

export function tick4p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 4.6);
}
export function tick4p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 4.6).length;
}
export function tick4p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick4p6sHits(paths) === 0;
}

export function tick4p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 4.8);
}
export function tick4p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 4.8).length;
}
export function tick4p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick4p8sHits(paths) === 0;
}

export function tick5s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 5);
}
export function tick5sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 5).length;
}
export function tick5sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick5sHits(paths) === 0;
}

export function tick5p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 5.2);
}
export function tick5p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 5.2).length;
}
export function tick5p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick5p2sHits(paths) === 0;
}

export function tick5p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 5.4);
}
export function tick5p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 5.4).length;
}
export function tick5p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick5p4sHits(paths) === 0;
}

export function tick5p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 5.6);
}
export function tick5p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 5.6).length;
}
export function tick5p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick5p6sHits(paths) === 0;
}

export function tick5p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 5.8);
}
export function tick5p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 5.8).length;
}
export function tick5p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick5p8sHits(paths) === 0;
}

export function tick6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 6);
}
export function tick6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 6).length;
}
export function tick6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick6sHits(paths) === 0;
}

export function tick6p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 6.2);
}
export function tick6p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 6.2).length;
}
export function tick6p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick6p2sHits(paths) === 0;
}

export function tick6p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 6.4);
}
export function tick6p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 6.4).length;
}
export function tick6p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick6p4sHits(paths) === 0;
}

export function tick6p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 6.6);
}
export function tick6p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 6.6).length;
}
export function tick6p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick6p6sHits(paths) === 0;
}

export function tick6p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 6.8);
}
export function tick6p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 6.8).length;
}
export function tick6p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick6p8sHits(paths) === 0;
}

export function tick7s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 7);
}
export function tick7sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 7).length;
}
export function tick7sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick7sHits(paths) === 0;
}

export function tick7p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 7.2);
}
export function tick7p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 7.2).length;
}
export function tick7p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick7p2sHits(paths) === 0;
}

export function tick7p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 7.4);
}
export function tick7p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 7.4).length;
}
export function tick7p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick7p4sHits(paths) === 0;
}

export function tick7p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 7.6);
}
export function tick7p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 7.6).length;
}
export function tick7p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick7p6sHits(paths) === 0;
}

export function tick7p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 7.8);
}
export function tick7p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 7.8).length;
}
export function tick7p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick7p8sHits(paths) === 0;
}

export function tick8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 8);
}
export function tick8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 8).length;
}
export function tick8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick8sHits(paths) === 0;
}

export function tick8p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 8.2);
}
export function tick8p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 8.2).length;
}
export function tick8p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick8p2sHits(paths) === 0;
}

export function tick8p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 8.4);
}
export function tick8p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 8.4).length;
}
export function tick8p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick8p4sHits(paths) === 0;
}

export function tick8p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 8.6);
}
export function tick8p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 8.6).length;
}
export function tick8p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick8p6sHits(paths) === 0;
}

export function tick8p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 8.8);
}
export function tick8p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 8.8).length;
}
export function tick8p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick8p8sHits(paths) === 0;
}

export function tick9s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 9);
}
export function tick9sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 9).length;
}
export function tick9sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick9sHits(paths) === 0;
}

export function tick9p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 9.2);
}
export function tick9p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 9.2).length;
}
export function tick9p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick9p2sHits(paths) === 0;
}

export function tick9p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 9.4);
}
export function tick9p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 9.4).length;
}
export function tick9p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick9p4sHits(paths) === 0;
}

export function tick9p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 9.6);
}
export function tick9p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 9.6).length;
}
export function tick9p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick9p6sHits(paths) === 0;
}

export function tick9p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 9.8);
}
export function tick9p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 9.8).length;
}
export function tick9p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick9p8sHits(paths) === 0;
}

export function tick10s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 10);
}
export function tick10sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 10).length;
}
export function tick10sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick10sHits(paths) === 0;
}

export function tick10p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 10.2);
}
export function tick10p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 10.2).length;
}
export function tick10p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick10p2sHits(paths) === 0;
}

export function tick10p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 10.4);
}
export function tick10p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 10.4).length;
}
export function tick10p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick10p4sHits(paths) === 0;
}

export function tick10p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 10.6);
}
export function tick10p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 10.6).length;
}
export function tick10p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick10p6sHits(paths) === 0;
}

export function tick10p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 10.8);
}
export function tick10p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 10.8).length;
}
export function tick10p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick10p8sHits(paths) === 0;
}

export function tick11s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 11);
}
export function tick11sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 11).length;
}
export function tick11sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick11sHits(paths) === 0;
}

export function tick11p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 11.2);
}
export function tick11p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 11.2).length;
}
export function tick11p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick11p2sHits(paths) === 0;
}

export function tick11p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 11.4);
}
export function tick11p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 11.4).length;
}
export function tick11p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick11p4sHits(paths) === 0;
}

export function tick11p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 11.6);
}
export function tick11p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 11.6).length;
}
export function tick11p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick11p6sHits(paths) === 0;
}

export function tick11p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 11.8);
}
export function tick11p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 11.8).length;
}
export function tick11p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick11p8sHits(paths) === 0;
}

export function tick12s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 12);
}
export function tick12sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 12).length;
}
export function tick12sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick12sHits(paths) === 0;
}

export function tick12p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 12.2);
}
export function tick12p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 12.2).length;
}
export function tick12p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick12p2sHits(paths) === 0;
}

export function tick12p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 12.4);
}
export function tick12p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 12.4).length;
}
export function tick12p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick12p4sHits(paths) === 0;
}

export function tick12p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 12.6);
}
export function tick12p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 12.6).length;
}
export function tick12p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick12p6sHits(paths) === 0;
}

export function tick12p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 12.8);
}
export function tick12p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 12.8).length;
}
export function tick12p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick12p8sHits(paths) === 0;
}

export function tick13s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 13);
}
export function tick13sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 13).length;
}
export function tick13sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick13sHits(paths) === 0;
}

export function tick13p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 13.2);
}
export function tick13p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 13.2).length;
}
export function tick13p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick13p2sHits(paths) === 0;
}

export function tick13p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 13.4);
}
export function tick13p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 13.4).length;
}
export function tick13p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick13p4sHits(paths) === 0;
}

export function tick13p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 13.6);
}
export function tick13p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 13.6).length;
}
export function tick13p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick13p6sHits(paths) === 0;
}

export function tick13p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 13.8);
}
export function tick13p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 13.8).length;
}
export function tick13p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick13p8sHits(paths) === 0;
}

export function tick14s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 14);
}
export function tick14sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 14).length;
}
export function tick14sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick14sHits(paths) === 0;
}

export function tick14p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 14.2);
}
export function tick14p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 14.2).length;
}
export function tick14p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick14p2sHits(paths) === 0;
}

export function tick14p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 14.4);
}
export function tick14p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 14.4).length;
}
export function tick14p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick14p4sHits(paths) === 0;
}

export function tick14p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 14.6);
}
export function tick14p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 14.6).length;
}
export function tick14p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick14p6sHits(paths) === 0;
}

export function tick14p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 14.8);
}
export function tick14p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 14.8).length;
}
export function tick14p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick14p8sHits(paths) === 0;
}

export function tick15s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 15);
}
export function tick15sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 15).length;
}
export function tick15sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick15sHits(paths) === 0;
}

export function tick15p2s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 15.2);
}
export function tick15p2sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 15.2).length;
}
export function tick15p2sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick15p2sHits(paths) === 0;
}

export function tick15p4s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 15.4);
}
export function tick15p4sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 15.4).length;
}
export function tick15p4sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick15p4sHits(paths) === 0;
}

export function tick15p6s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 15.6);
}
export function tick15p6sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 15.6).length;
}
export function tick15p6sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick15p6sHits(paths) === 0;
}

export function tick15p8s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 15.8);
}
export function tick15p8sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 15.8).length;
}
export function tick15p8sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick15p8sHits(paths) === 0;
}

export function tick16s(paths: readonly (readonly PathPoint[])[]): Array<PathPoint | null> {
  return lovatPlayhead(paths, 16);
}
export function tick16sHits(paths: readonly (readonly PathPoint[])[]): number {
  return improvePlayheadConflicts(paths, 16).length;
}
export function tick16sClear(paths: readonly (readonly PathPoint[])[]): boolean | null {
  if (paths.length < 2) return null;
  return tick16sHits(paths) === 0;
}

export function actionAutoLeaveOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_leave", matchSeconds);
}
export function actionAutoLeaveRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_leave", seconds);
}
export function actionAutoLeaveBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_leave", 2);
}
export function actionAutoLeaveVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_leave");
}

export function actionAutoFuelOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_fuel", matchSeconds);
}
export function actionAutoFuelRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_fuel", seconds);
}
export function actionAutoFuelBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_fuel", 2);
}
export function actionAutoFuelVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_fuel");
}

export function actionAutoL1Occupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_l1", matchSeconds);
}
export function actionAutoL1Rate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_l1", seconds);
}
export function actionAutoL1Bursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_l1", 2);
}
export function actionAutoL1Visible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_l1");
}

export function actionAutoL2Occupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_l2", matchSeconds);
}
export function actionAutoL2Rate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_l2", seconds);
}
export function actionAutoL2Bursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_l2", 2);
}
export function actionAutoL2Visible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_l2");
}

export function actionAutoL3Occupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_l3", matchSeconds);
}
export function actionAutoL3Rate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_l3", seconds);
}
export function actionAutoL3Bursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_l3", 2);
}
export function actionAutoL3Visible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_l3");
}

export function actionAutoL4Occupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_l4", matchSeconds);
}
export function actionAutoL4Rate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_l4", seconds);
}
export function actionAutoL4Bursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_l4", 2);
}
export function actionAutoL4Visible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_l4");
}

export function actionAutoProcessorOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_processor", matchSeconds);
}
export function actionAutoProcessorRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_processor", seconds);
}
export function actionAutoProcessorBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_processor", 2);
}
export function actionAutoProcessorVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_processor");
}

export function actionAutoNetOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_net", matchSeconds);
}
export function actionAutoNetRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_net", seconds);
}
export function actionAutoNetBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_net", 2);
}
export function actionAutoNetVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_net");
}

export function actionTeleopFuelOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "teleop_fuel", matchSeconds);
}
export function actionTeleopFuelRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "teleop_fuel", seconds);
}
export function actionTeleopFuelBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "teleop_fuel", 3);
}
export function actionTeleopFuelVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "teleop_fuel");
}

export function actionTeleopL1Occupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "teleop_l1", matchSeconds);
}
export function actionTeleopL1Rate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "teleop_l1", seconds);
}
export function actionTeleopL1Bursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "teleop_l1", 3);
}
export function actionTeleopL1Visible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "teleop_l1");
}

export function actionTeleopL2Occupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "teleop_l2", matchSeconds);
}
export function actionTeleopL2Rate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "teleop_l2", seconds);
}
export function actionTeleopL2Bursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "teleop_l2", 3);
}
export function actionTeleopL2Visible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "teleop_l2");
}

export function actionTeleopL3Occupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "teleop_l3", matchSeconds);
}
export function actionTeleopL3Rate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "teleop_l3", seconds);
}
export function actionTeleopL3Bursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "teleop_l3", 3);
}
export function actionTeleopL3Visible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "teleop_l3");
}

export function actionTeleopL4Occupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "teleop_l4", matchSeconds);
}
export function actionTeleopL4Rate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "teleop_l4", seconds);
}
export function actionTeleopL4Bursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "teleop_l4", 3);
}
export function actionTeleopL4Visible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "teleop_l4");
}

export function actionTeleopProcessorOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "teleop_processor", matchSeconds);
}
export function actionTeleopProcessorRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "teleop_processor", seconds);
}
export function actionTeleopProcessorBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "teleop_processor", 3);
}
export function actionTeleopProcessorVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "teleop_processor");
}

export function actionTeleopNetOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "teleop_net", matchSeconds);
}
export function actionTeleopNetRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "teleop_net", seconds);
}
export function actionTeleopNetBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "teleop_net", 3);
}
export function actionTeleopNetVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "teleop_net");
}

export function actionTeleopAlgaeOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "teleop_algae", matchSeconds);
}
export function actionTeleopAlgaeRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "teleop_algae", seconds);
}
export function actionTeleopAlgaeBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "teleop_algae", 3);
}
export function actionTeleopAlgaeVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "teleop_algae");
}

export function actionDefenseContactOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "defense_contact", matchSeconds);
}
export function actionDefenseContactRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "defense_contact", seconds);
}
export function actionDefenseContactBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "defense_contact", 3);
}
export function actionDefenseContactVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "defense_contact");
}

export function actionDefenseCampOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "defense_camp", matchSeconds);
}
export function actionDefenseCampRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "defense_camp", seconds);
}
export function actionDefenseCampBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "defense_camp", 3);
}
export function actionDefenseCampVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "defense_camp");
}

export function actionDefenseCrossOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "defense_cross", matchSeconds);
}
export function actionDefenseCrossRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "defense_cross", seconds);
}
export function actionDefenseCrossBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "defense_cross", 3);
}
export function actionDefenseCrossVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "defense_cross");
}

export function actionFeedCoralOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "feed_coral", matchSeconds);
}
export function actionFeedCoralRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "feed_coral", seconds);
}
export function actionFeedCoralBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "feed_coral", 3);
}
export function actionFeedCoralVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "feed_coral");
}

export function actionFeedAlgaeOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "feed_algae", matchSeconds);
}
export function actionFeedAlgaeRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "feed_algae", seconds);
}
export function actionFeedAlgaeBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "feed_algae", 3);
}
export function actionFeedAlgaeVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "feed_algae");
}

export function actionIntakeStationOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "intake_station", matchSeconds);
}
export function actionIntakeStationRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "intake_station", seconds);
}
export function actionIntakeStationBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "intake_station", 3);
}
export function actionIntakeStationVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "intake_station");
}

export function actionIntakeGroundOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "intake_ground", matchSeconds);
}
export function actionIntakeGroundRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "intake_ground", seconds);
}
export function actionIntakeGroundBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "intake_ground", 3);
}
export function actionIntakeGroundVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "intake_ground");
}

export function actionClimbParkOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "climb_park", matchSeconds);
}
export function actionClimbParkRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "climb_park", seconds);
}
export function actionClimbParkBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "climb_park", 3);
}
export function actionClimbParkVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "climb_park");
}

export function actionClimbShallowOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "climb_shallow", matchSeconds);
}
export function actionClimbShallowRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "climb_shallow", seconds);
}
export function actionClimbShallowBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "climb_shallow", 3);
}
export function actionClimbShallowVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "climb_shallow");
}

export function actionClimbDeepOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "climb_deep", matchSeconds);
}
export function actionClimbDeepRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "climb_deep", seconds);
}
export function actionClimbDeepBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "climb_deep", 3);
}
export function actionClimbDeepVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "climb_deep");
}

export function actionFoulMinorOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "foul_minor", matchSeconds);
}
export function actionFoulMinorRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "foul_minor", seconds);
}
export function actionFoulMinorBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "foul_minor", 3);
}
export function actionFoulMinorVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "foul_minor");
}

export function actionFoulMajorOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "foul_major", matchSeconds);
}
export function actionFoulMajorRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "foul_major", seconds);
}
export function actionFoulMajorBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "foul_major", 3);
}
export function actionFoulMajorVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "foul_major");
}

export function actionDisabledOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "disabled", matchSeconds);
}
export function actionDisabledRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "disabled", seconds);
}
export function actionDisabledBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "disabled", 3);
}
export function actionDisabledVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "disabled");
}

export function actionTipOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "tip", matchSeconds);
}
export function actionTipRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "tip", seconds);
}
export function actionTipBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "tip", 3);
}
export function actionTipVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "tip");
}

export function actionCycleStartOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "cycle_start", matchSeconds);
}
export function actionCycleStartRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "cycle_start", seconds);
}
export function actionCycleStartBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "cycle_start", 3);
}
export function actionCycleStartVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "cycle_start");
}

export function actionCycleScoreOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "cycle_score", matchSeconds);
}
export function actionCycleScoreRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "cycle_score", seconds);
}
export function actionCycleScoreBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "cycle_score", 3);
}
export function actionCycleScoreVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "cycle_score");
}

export function actionCycleDropOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "cycle_drop", matchSeconds);
}
export function actionCycleDropRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "cycle_drop", seconds);
}
export function actionCycleDropBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "cycle_drop", 3);
}
export function actionCycleDropVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "cycle_drop");
}

export function actionAutoTaxiOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "auto_taxi", matchSeconds);
}
export function actionAutoTaxiRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "auto_taxi", seconds);
}
export function actionAutoTaxiBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "auto_taxi", 2);
}
export function actionAutoTaxiVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "auto_taxi");
}

export function actionBargePlaceOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "barge_place", matchSeconds);
}
export function actionBargePlaceRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "barge_place", seconds);
}
export function actionBargePlaceBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "barge_place", 3);
}
export function actionBargePlaceVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "barge_place");
}

export function actionProcessorPlaceOccupancy(actions: readonly TimelineAction[], matchSeconds = 150): number | null {
  return occupancy(actions, "processor_place", matchSeconds);
}
export function actionProcessorPlaceRate(actions: readonly TimelineAction[], seconds: number): number | null {
  return actionRate(actions, "processor_place", seconds);
}
export function actionProcessorPlaceBursts(actions: readonly TimelineAction[]): number | null {
  return burstCount(actions, "processor_place", 3);
}
export function actionProcessorPlaceVisible(phase: ContextPhase): boolean {
  return lovatVisibleWhen(phase, "processor_place");
}

export function leftoverQuads1(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 1 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads1Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads1(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads2(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 2 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads2Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads2(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads3(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 3 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads3Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads3(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads4(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 4 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads4Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads4(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads5(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 5 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads5Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads5(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads6(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 6 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads6Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads6(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads7(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 7 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads7Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads7(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads8(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 8 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads8Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads8(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads9(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 9 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads9Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads9(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads10(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 10 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads10Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads10(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads11(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 11 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads11Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads11(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads12(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 12 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads12Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads12(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads13(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 13 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads13Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads13(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads14(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 14 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads14Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads14(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads15(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 15 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads15Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads15(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads16(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 16 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads16Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads16(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads17(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 17 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads17Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads17(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads18(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 18 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads18Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads18(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads19(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 19 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads19Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads19(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads20(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 20 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads20Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads20(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads21(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 21 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads21Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads21(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads22(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 22 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads22Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads22(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads23(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 23 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads23Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads23(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads24(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 24 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads24Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads24(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads25(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 25 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads25Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads25(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads26(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 26 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads26Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads26(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads27(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 27 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads27Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads27(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads28(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 28 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads28Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads28(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads29(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 29 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads29Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads29(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads30(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 30 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads30Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads30(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads31(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 31 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads31Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads31(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads32(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 32 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads32Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads32(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads33(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 33 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads33Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads33(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads34(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 34 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads34Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads34(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads35(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 35 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads35Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads35(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads36(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 36 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads36Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads36(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads37(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 37 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads37Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads37(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads38(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 38 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads38Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads38(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads39(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 39 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads39Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads39(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads40(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 40 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads40Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads40(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads41(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 41 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads41Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads41(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads42(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 42 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads42Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads42(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads43(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 43 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads43Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads43(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads44(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 44 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads44Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads44(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads45(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 45 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads45Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads45(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads46(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 46 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads46Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads46(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads47(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 47 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads47Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads47(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads48(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 48 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads48Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads48(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads49(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 49 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads49Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads49(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads50(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 50 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads50Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads50(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads51(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 51 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads51Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads51(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads52(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 52 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads52Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads52(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads53(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 53 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads53Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads53(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads54(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 54 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads54Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads54(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads55(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 55 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads55Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads55(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads56(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 56 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads56Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads56(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads57(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 57 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads57Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads57(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads58(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 58 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads58Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads58(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads59(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 59 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads59Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads59(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads60(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 60 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads60Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads60(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads61(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 61 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads61Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads61(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads62(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 62 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads62Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads62(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads63(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 63 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads63Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads63(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads64(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 64 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads64Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads64(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads65(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 65 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads65Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads65(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads66(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 66 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads66Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads66(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads67(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 67 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads67Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads67(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads68(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 68 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads68Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads68(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads69(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 69 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads69Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads69(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads70(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 70 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads70Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads70(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads71(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 71 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads71Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads71(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads72(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 72 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads72Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads72(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads73(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 73 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads73Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads73(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads74(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 74 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads74Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads74(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads75(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 75 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads75Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads75(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads76(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 76 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads76Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads76(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads77(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 77 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads77Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads77(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads78(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 78 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads78Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads78(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads79(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 79 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads79Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads79(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads80(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 80 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads80Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads80(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads81(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 81 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads81Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads81(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads82(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 82 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads82Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads82(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads83(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 83 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads83Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads83(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads84(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 84 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads84Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads84(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads85(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 85 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads85Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads85(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads86(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 86 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads86Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads86(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads87(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 87 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads87Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads87(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads88(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 88 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads88Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads88(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads89(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 89 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads89Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads89(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads90(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 90 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads90Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads90(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads91(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 91 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads91Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads91(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads92(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 92 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads92Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads92(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads93(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 93 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads93Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads93(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads94(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 94 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads94Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads94(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads95(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 95 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads95Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads95(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads96(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 96 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads96Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads96(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads97(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 97 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads97Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads97(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads98(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 98 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads98Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads98(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads99(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 99 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads99Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads99(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads100(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 100 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads100Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads100(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads101(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 101 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads101Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads101(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads102(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 102 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads102Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads102(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads103(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 103 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads103Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads103(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads104(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 104 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads104Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads104(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads105(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 105 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads105Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads105(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads106(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 106 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads106Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads106(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads107(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 107 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads107Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads107(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads108(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 108 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads108Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads108(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads109(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 109 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads109Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads109(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads110(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 110 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads110Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads110(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads111(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 111 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads111Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads111(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads112(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 112 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads112Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads112(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads113(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 113 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads113Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads113(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads114(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 114 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads114Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads114(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads115(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 115 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads115Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads115(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads116(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 116 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads116Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads116(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads117(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 117 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads117Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads117(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads118(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 118 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads118Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads118(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads119(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 119 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads119Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads119(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads120(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 120 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads120Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads120(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads121(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 121 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads121Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads121(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads122(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 122 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads122Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads122(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads123(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 123 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads123Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads123(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads124(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 124 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads124Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads124(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads125(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 125 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads125Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads125(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads126(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 126 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads126Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads126(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads127(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 127 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads127Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads127(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads128(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 128 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads128Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads128(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads129(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 129 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads129Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads129(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads130(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 130 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads130Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads130(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads131(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 131 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads131Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads131(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads132(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 132 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads132Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads132(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads133(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 133 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads133Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads133(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads134(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 134 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads134Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads134(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads135(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 135 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads135Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads135(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads136(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 136 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads136Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads136(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads137(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 137 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads137Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads137(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads138(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 138 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads138Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads138(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads139(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 139 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads139Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads139(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads140(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 140 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads140Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads140(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads141(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 141 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads141Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads141(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads142(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 142 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads142Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads142(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads143(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 143 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads143Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads143(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads144(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 144 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads144Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads144(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads145(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 145 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads145Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads145(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads146(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 146 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads146Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads146(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads147(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 147 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads147Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads147(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads148(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 148 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads148Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads148(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads149(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 149 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads149Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads149(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads150(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 150 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads150Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads150(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads151(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 151 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads151Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads151(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads152(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 152 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads152Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads152(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads153(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 153 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads153Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads153(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads154(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 154 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads154Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads154(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads155(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 155 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads155Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads155(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads156(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 156 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads156Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads156(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads157(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 157 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads157Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads157(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads158(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 158 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads158Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads158(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads159(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 159 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads159Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads159(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads160(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 160 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads160Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads160(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads161(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 161 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads161Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads161(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads162(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 162 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads162Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads162(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads163(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 163 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads163Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads163(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads164(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 164 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads164Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads164(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads165(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 165 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads165Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads165(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads166(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 166 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads166Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads166(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads167(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 167 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads167Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads167(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads168(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 168 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads168Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads168(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads169(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 169 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads169Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads169(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads170(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 170 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads170Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads170(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads171(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 171 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads171Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads171(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads172(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 172 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads172Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads172(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads173(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 173 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads173Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads173(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads174(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 174 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads174Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads174(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads175(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 175 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads175Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads175(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads176(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 176 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads176Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads176(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads177(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 177 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads177Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads177(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads178(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 178 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads178Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads178(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads179(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 179 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads179Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads179(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads180(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 180 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads180Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads180(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads181(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 181 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads181Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads181(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads182(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 182 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads182Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads182(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads183(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 183 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads183Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads183(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads184(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 184 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads184Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads184(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads185(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 185 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads185Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads185(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads186(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 186 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads186Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads186(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads187(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 187 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads187Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads187(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads188(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 188 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads188Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads188(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads189(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 189 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads189Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads189(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads190(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 190 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads190Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads190(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads191(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 191 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads191Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads191(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads192(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 192 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads192Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads192(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads193(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 193 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads193Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads193(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads194(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 194 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads194Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads194(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads195(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 195 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads195Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads195(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads196(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 196 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads196Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads196(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads197(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 197 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads197Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads197(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads198(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 198 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads198Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads198(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads199(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 199 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads199Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads199(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads200(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 200 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads200Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads200(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads201(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 201 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads201Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads201(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads202(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 202 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads202Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads202(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads203(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 203 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads203Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads203(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads204(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 204 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads204Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads204(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads205(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 205 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads205Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads205(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads206(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 206 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads206Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads206(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads207(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 207 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads207Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads207(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads208(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 208 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads208Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads208(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads209(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 209 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads209Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads209(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

export function leftoverQuads210(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const inflate = Math.sqrt(1 + 210 / 12);
  return lovatExactWin({ mean: red.mean, std: red.std * inflate }, { mean: blue.mean, std: blue.std * inflate });
}
export function leftoverQuads210Flip(red: { mean: number; std: number }, blue: { mean: number; std: number }): ReturnType<typeof lovatExactWin> {
  const pred = leftoverQuads210(red, blue);
  return pred ? flipAllianceWin(pred) : null;
}

