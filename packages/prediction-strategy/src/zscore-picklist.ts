/**
 * Lovat-style picklist ranking: compare each robot to this event, then weight
 * those comparisons. Population standard deviation (N, not N-1). Teams without
 * a real value for a metric skip that term — never invent 0.
 */

export const PICKLIST_METRIC_IDS = [
  "totalPoints",
  "autoPoints",
  "teleopPoints",
  "driverAbility",
  "endgameClimb",
  "autoClimb",
  "defenseEffectiveness",
  "contactDefenseTime",
  "campingDefenseTime",
  "totalDefenseTime",
  "totalFuelThroughput",
  "totalFuelFed",
  "feedingRate",
  "scoringRate",
  "estimatedSuccessfulFuelRate",
  "estimatedTotalFuelScored",
  /**
   * The two things a team's own scouts know that a season rating cannot.
   *
   * EPA and the OPR family are built from final scores, so a robot that dies
   * twice and a robot that is merely inconsistent look identical to them — an
   * average with some bad matches in it. The people watching know the
   * difference, and at a pick-list meeting it is usually the difference that
   * decides. Both are expressed so that higher is better, like every other
   * slider here.
   */
  "consistency",
  "reliability",
] as const;

/** The metrics every team shares, from ratings and the standard scouting profile. */
export type BuiltinPicklistMetricId = (typeof PICKLIST_METRIC_IDS)[number];

/**
 * A number the team's own scouting form collects — "form:teleopCycles".
 *
 * The built-in list above was written for one season's game (fuel fed,
 * camping defense time…). A team whose form asks for cycles, notes scored or
 * fouls could not weigh any of it. Form metrics make the pick list follow the
 * form, so a new game needs a new form, not new code.
 */
export type FormMetricId = `form:${string}`;

export type PicklistMetricId = BuiltinPicklistMetricId | FormMetricId;

export function isFormMetricId(id: string): id is FormMetricId {
  return id.startsWith("form:") && id.length > 5;
}

export function formMetricId(fieldKey: string): FormMetricId {
  return `form:${fieldKey}`;
}

/** Fouls, misses, drops: less is better, so the value is negated for ranking. */
const LOWER_IS_BETTER_FIELD = /foul|penalt|card|miss|drop|fail|error/i;

export function formFieldLowerIsBetter(fieldKey: string): boolean {
  return LOWER_IS_BETTER_FIELD.test(fieldKey);
}

/** "teleopCycles" → "Teleop cycles"; "fouls" → "Fewer fouls". */
export function formMetricLabel(id: FormMetricId): string {
  const key = id.slice("form:".length);
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  if (formFieldLowerIsBetter(key)) return `Fewer ${spaced}`;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export type PicklistMetricSource = "event" | "scout";

export type PicklistMetricDef = {
  id: PicklistMetricId;
  label: string;
  source: PicklistMetricSource;
};

/** Student-facing labels — no EPA / z-score / TBA wording. */
export const PICKLIST_METRICS: readonly PicklistMetricDef[] = [
  { id: "totalPoints", label: "Total points", source: "event" },
  { id: "autoPoints", label: "Auto points", source: "event" },
  { id: "teleopPoints", label: "Teleop points", source: "event" },
  { id: "driverAbility", label: "Driver ability", source: "scout" },
  { id: "endgameClimb", label: "Endgame climb", source: "event" },
  { id: "autoClimb", label: "Auto climb", source: "scout" },
  { id: "defenseEffectiveness", label: "Defense effectiveness", source: "scout" },
  { id: "contactDefenseTime", label: "Contact defense time", source: "scout" },
  { id: "campingDefenseTime", label: "Camping defense time", source: "scout" },
  { id: "totalDefenseTime", label: "Total defensive time", source: "scout" },
  { id: "totalFuelThroughput", label: "Total fuel throughput", source: "scout" },
  { id: "totalFuelFed", label: "Total fuel fed", source: "scout" },
  { id: "feedingRate", label: "Feeding rate", source: "scout" },
  { id: "scoringRate", label: "Scoring rate", source: "scout" },
  { id: "estimatedSuccessfulFuelRate", label: "Estimated successful fuel rate", source: "scout" },
  { id: "estimatedTotalFuelScored", label: "Estimated total fuel scored", source: "scout" },
  { id: "consistency", label: "Does the same thing every match", source: "scout" },
  { id: "reliability", label: "Finishes the match", source: "scout" },
];

export type TeamMetricRow = {
  teamKey: string;
  values: Partial<Record<PicklistMetricId, number | null | undefined>>;
};

export type MetricWeight = {
  id: PicklistMetricId;
  weight: number;
};

export type FieldStat = {
  mean: number;
  std: number;
  n: number;
};

export type FieldStats = Partial<Record<PicklistMetricId, FieldStat>>;

export type PicklistScoreBreakdown = {
  id: PicklistMetricId;
  value: number;
  z: number;
  weight: number;
  term: number;
};

export type RankedPicklistTeam = {
  teamKey: string;
  score: number | null;
  breakdown: PicklistScoreBreakdown[];
};

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function picklistMetricLabel(id: PicklistMetricId): string {
  if (isFormMetricId(id)) return formMetricLabel(id);
  const found = PICKLIST_METRICS.find((metric) => metric.id === id);
  return found?.label ?? id;
}

export function finiteValues(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => value != null && Number.isFinite(value));
}

/** Population mean. Null when nobody at the event has a real value. */
export function populationMean(values: number[]): number | null {
  const finite = finiteValues(values);
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

/**
 * Population standard deviation (divide by N). Needs two real values so a
 * comparison to this event is defined. Zero spread → 0 so every team ties.
 */
export function populationStdDev(values: number[]): number | null {
  const finite = finiteValues(values);
  if (finite.length < 2) return null;
  const mean = populationMean(finite);
  if (mean == null) return null;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return Math.sqrt(variance);
}

/** (value − field mean) / field std. Zero spread scores 0, not a fake 1. */
export function zScore(value: number, mean: number, std: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(std)) return null;
  if (std === 0) return 0;
  return (value - mean) / std;
}

export function fieldStatsFromRows(rows: TeamMetricRow[]): FieldStats {
  const stats: FieldStats = {};
  const formIds = new Set<FormMetricId>();
  for (const row of rows) {
    for (const key of Object.keys(row.values)) if (isFormMetricId(key)) formIds.add(key);
  }
  for (const metric of [...PICKLIST_METRIC_IDS, ...formIds] as PicklistMetricId[]) {
    const values = finiteValues(rows.map((row) => row.values[metric]));
    const mean = populationMean(values);
    const std = populationStdDev(values);
    if (mean == null || std == null) continue;
    stats[metric] = { mean: round4(mean), std: round4(std), n: values.length };
  }
  return stats;
}

export function scoreTeamAgainstField(
  row: TeamMetricRow,
  weights: readonly MetricWeight[],
  field: FieldStats,
): RankedPicklistTeam {
  const breakdown: PicklistScoreBreakdown[] = [];
  for (const { id, weight } of weights) {
    if (!Number.isFinite(weight) || weight === 0) continue;
    const value = row.values[id];
    if (value == null || !Number.isFinite(value)) continue;
    const stat = field[id];
    if (!stat) continue;
    const z = zScore(value, stat.mean, stat.std);
    if (z == null) continue;
    const term = z * weight;
    breakdown.push({
      id,
      value,
      z: round4(z),
      weight,
      term: round4(term),
    });
  }
  if (breakdown.length === 0) {
    return { teamKey: row.teamKey, score: null, breakdown };
  }
  const score = breakdown.reduce((sum, item) => sum + item.term, 0);
  return { teamKey: row.teamKey, score: round4(score), breakdown };
}

/**
 * Weighted field-comparison ranking. Pass `field` from the whole event when
 * you have it; otherwise stats are computed from the same candidate rows.
 * Teams with no usable metrics stay at the bottom (score null) — never a 0 fill.
 */
export function rankByWeightedZScores(
  rows: TeamMetricRow[],
  weights: readonly MetricWeight[],
  field?: FieldStats,
): RankedPicklistTeam[] {
  const stats = field ?? fieldStatsFromRows(rows);
  return rows
    .map((row) => scoreTeamAgainstField(row, weights, stats))
    .sort((a, b) => {
      if (a.score == null && b.score == null) return a.teamKey.localeCompare(b.teamKey);
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      const diff = b.score - a.score;
      if (diff !== 0) return diff;
      return a.teamKey.localeCompare(b.teamKey);
    });
}

export function defaultPicklistWeights(): MetricWeight[] {
  return PICKLIST_METRICS.map((metric) => ({
    id: metric.id,
    weight: metric.source === "event" ? 1 : 0,
  }));
}
