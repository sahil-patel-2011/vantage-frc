/**
 * Lovat-style Endgame board — last 24 matches, field-shrunk.
 * Missing samples stay blank. Nothing here invents a rating.
 */

export const SLUG = "endgame-last24-shrink";
export const PHASE_LABEL = "Endgame";
export const WINDOW_LABEL = "last 24 matches";
export const KERNEL_LABEL = "field-shrunk";
export const WINDOW_N: number | null = 24;
export const QUALS_ONLY = false;
export const PLAYOFFS_ONLY = false;
export const EWMA_ALPHA = 0.505;
export const TRIM_FRACTION = 0.184;
export const NEAR_Z = 0.347;
export const ROBOT_RADIUS_IN = 17.0;
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
  switch ("shrink") {
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

export function bootstrapMean(values: readonly number[], draws = 24, seed = 4061095685): number | null {
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
    kernel: "shrink",
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
