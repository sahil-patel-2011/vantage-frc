/**
 * Lovat Team Lookup: tap a team, see averages vs this event, sparklines,
 * contribution, and notes. Event numbers come from cached ratings. Scout
 * numbers stay blank until this team has real scout rows — never a 0 fill.
 */

import {
  fieldStatsFromRows,
  picklistMetricLabel,
  populationMean,
  populationStdDev,
  zScore,
  type FieldStat,
  type PicklistMetricId,
  type TeamMetricRow,
} from "@vantage/prediction-strategy";

export const LOVAT_LOOKUP_METRIC_IDS = [
  "totalPoints",
  "autoPoints",
  "teleopPoints",
  "endgameClimb",
  "rank",
  "wins",
  "opr",
  "dpr",
  "ccwm",
  "driverAbility",
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
  "reliability",
] as const;

export type LovatLookupMetricId = (typeof LOVAT_LOOKUP_METRIC_IDS)[number];

export type LookupFieldStats = Partial<Record<LovatLookupMetricId, FieldStat>>;

export type LovatLookupSource = "event" | "scout";

export type LovatLookupMetricDef = {
  id: LovatLookupMetricId;
  label: string;
  source: LovatLookupSource;
  detail: string;
};

export const LOVAT_LOOKUP_METRICS: readonly LovatLookupMetricDef[] = [
  { id: "totalPoints", label: "Total points", source: "event", detail: "Season / event rating" },
  { id: "autoPoints", label: "Auto points", source: "event", detail: "Autonomous rating" },
  { id: "teleopPoints", label: "Teleop points", source: "event", detail: "Teleop rating" },
  { id: "endgameClimb", label: "Endgame climb", source: "event", detail: "Endgame rating" },
  { id: "rank", label: "Rank", source: "event", detail: "Event ranking — lower is better" },
  { id: "wins", label: "Wins", source: "event", detail: "Recorded wins at this event" },
  { id: "opr", label: "Offensive rating", source: "event", detail: "Offensive contribution" },
  { id: "dpr", label: "Defensive rating", source: "event", detail: "Points allowed contribution" },
  { id: "ccwm", label: "Winning margin", source: "event", detail: "Calculated contribution to winning margin" },
  { id: "driverAbility", label: "Driver ability", source: "scout", detail: "From our scouting" },
  { id: "autoClimb", label: "Auto climb", source: "scout", detail: "From our scouting" },
  { id: "defenseEffectiveness", label: "Defense effectiveness", source: "scout", detail: "From our scouting" },
  { id: "contactDefenseTime", label: "Contact defense time", source: "scout", detail: "From our scouting" },
  { id: "campingDefenseTime", label: "Camping defense time", source: "scout", detail: "From our scouting" },
  { id: "totalDefenseTime", label: "Total defensive time", source: "scout", detail: "From our scouting" },
  { id: "totalFuelThroughput", label: "Total fuel throughput", source: "scout", detail: "From our scouting" },
  { id: "totalFuelFed", label: "Total fuel fed", source: "scout", detail: "From our scouting" },
  { id: "feedingRate", label: "Feeding rate", source: "scout", detail: "From our scouting" },
  { id: "scoringRate", label: "Scoring rate", source: "scout", detail: "From our scouting" },
  { id: "estimatedSuccessfulFuelRate", label: "Successful fuel rate", source: "scout", detail: "From our scouting" },
  { id: "estimatedTotalFuelScored", label: "Estimated fuel scored", source: "scout", detail: "From our scouting" },
  { id: "reliability", label: "Reliability", source: "scout", detail: "From our scouting" },
];

export type LookupSeriesPoint = { label: string; value: number };

export type FieldCompareTone = "above" | "near" | "below" | "unknown";

export type FieldCompare = {
  tone: FieldCompareTone;
  label: string;
  delta: number | null;
  z: number | null;
};

export type LookupCard = {
  id: LovatLookupMetricId;
  label: string;
  source: LovatLookupSource;
  detail: string;
  value: number | null;
  display: string;
  compare: FieldCompare;
  contribution: number | null;
  sparkline: string | null;
  sample: number;
};

export type EventRatingRow = {
  teamKey: string;
  epaTotal?: number | null;
  epaAuto?: number | null;
  epaTeleop?: number | null;
  epaEndgame?: number | null;
  rank?: number | null;
  wins?: number | null;
  opr?: number | null;
  dpr?: number | null;
  ccwm?: number | null;
};

export type ScoutAverageRow = {
  teamKey: string;
  values: Partial<Record<LovatLookupMetricId, number | null>>;
  sample: number;
};

const invertBetter = new Set<LovatLookupMetricId>(["rank", "dpr"]);

export function lookupMetricLabel(id: LovatLookupMetricId): string {
  return LOVAT_LOOKUP_METRICS.find((metric) => metric.id === id)?.label ?? picklistMetricLabel(id as PicklistMetricId);
}

export function formatLookupValue(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

export function fieldCompare(value: number | null, mean: number | null, std: number | null, invert = false): FieldCompare {
  if (value == null || mean == null || !Number.isFinite(value) || !Number.isFinite(mean)) {
    return { tone: "unknown", label: "Need two teams at this event", delta: null, z: null };
  }
  const delta = invert ? mean - value : value - mean;
  const z = std != null && std > 0 ? zScore(invert ? mean : value, invert ? value : mean, std) : std === 0 ? 0 : null;
  const magnitude = z != null ? Math.abs(z) : Math.abs(delta) / Math.max(1, Math.abs(mean));
  if (magnitude < 0.35) {
    return { tone: "near", label: "Near this event", delta, z };
  }
  if (delta > 0) return { tone: "above", label: "Above this event", delta, z };
  return { tone: "below", label: "Below this event", delta, z };
}

/** Team value as a share of the event average. Null when either number is missing. */
export function contributionShare(value: number | null, fieldMean: number | null): number | null {
  if (value == null || fieldMean == null || !Number.isFinite(value) || !Number.isFinite(fieldMean) || fieldMean === 0) {
    return null;
  }
  return Math.round((value / fieldMean) * 1000) / 1000;
}

/**
 * Compact SVG path in a 72×28 viewBox. Needs two real points — a single
 * sample is a dot, not a trend we invented.
 */
export function sparklinePath(values: Array<number | null | undefined>, width = 72, height = 28): string | null {
  const points = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const step = points.length === 1 ? 0 : width / (points.length - 1);
  return points
    .map((value, index) => {
      const x = index * step;
      const y = span === 0 ? height / 2 : height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function seriesFromTrajectory(points: Array<{ year: number; epa: number }>): LookupSeriesPoint[] {
  return points
    .filter((point) => Number.isFinite(point.epa))
    .map((point) => ({ label: String(point.year), value: point.epa }));
}

export function ratingToMetricValues(row: EventRatingRow): Partial<Record<LovatLookupMetricId, number | null>> {
  return {
    totalPoints: row.epaTotal ?? null,
    autoPoints: row.epaAuto ?? null,
    teleopPoints: row.epaTeleop ?? null,
    endgameClimb: row.epaEndgame ?? null,
    rank: row.rank ?? null,
    wins: row.wins ?? null,
    opr: row.opr ?? null,
    dpr: row.dpr ?? null,
    ccwm: row.ccwm ?? null,
  };
}

export function eventRowsToMetricRows(rows: EventRatingRow[]): TeamMetricRow[] {
  return rows.map((row) => ({
    teamKey: row.teamKey,
    values: ratingToMetricValues(row),
  }));
}

const EXTRA_EVENT_IDS: LovatLookupMetricId[] = ["rank", "wins", "opr", "dpr", "ccwm"];

export function fieldStatsFromEventRows(rows: EventRatingRow[]): LookupFieldStats {
  const picklist = fieldStatsFromRows(eventRowsToMetricRows(rows));
  const extra: LookupFieldStats = { ...picklist };
  for (const id of EXTRA_EVENT_IDS) {
    const values = rows
      .map((row) => ratingToMetricValues(row)[id])
      .filter((value): value is number => value != null && Number.isFinite(value));
    const mean = populationMean(values);
    const std = populationStdDev(values);
    if (mean == null || std == null) continue;
    extra[id] = { mean, std, n: values.length };
  }
  return extra;
}

function sampleFor(id: LovatLookupMetricId, source: LovatLookupSource, eventN: number, scoutSample: number): number {
  return source === "event" ? eventN : scoutSample;
}

export function buildLookupCards(input: {
  teamKey: string;
  event: EventRatingRow | null;
  field: LookupFieldStats;
  scout?: ScoutAverageRow | null;
  history?: Array<number | null>;
  scoutSeries?: Partial<Record<LovatLookupMetricId, Array<number | null>>>;
}): LookupCard[] {
  const eventValues = input.event ? ratingToMetricValues(input.event) : {};
  const scoutValues = input.scout?.values ?? {};
  return LOVAT_LOOKUP_METRICS.map((metric) => {
    const value = metric.source === "event" ? (eventValues[metric.id] ?? null) : (scoutValues[metric.id] ?? null);
    const stat = input.field[metric.id];
    const compare = fieldCompare(value, stat?.mean ?? null, stat?.std ?? null, invertBetter.has(metric.id));
    const contribution = invertBetter.has(metric.id) ? null : contributionShare(value, stat?.mean ?? null);
    const spark =
      metric.id === "totalPoints"
        ? sparklinePath(input.history ?? [])
        : sparklinePath(input.scoutSeries?.[metric.id] ?? []);
    return {
      id: metric.id,
      label: metric.label,
      source: metric.source,
      detail: metric.source === "scout" && value == null ? "Needs setup — no scout rows yet" : metric.detail,
      value,
      display: formatLookupValue(value, metric.id === "rank" || metric.id === "wins" ? 0 : metric.id === "estimatedSuccessfulFuelRate" ? 2 : 1),
      compare,
      contribution,
      sparkline: spark,
      sample: sampleFor(metric.id, metric.source, stat?.n ?? 0, input.scout?.sample ?? 0),
    };
  });
}

export function lookupCardsWithValues(cards: LookupCard[]): LookupCard[] {
  return cards.filter((card) => card.value != null);
}

export const SCOUT_LOOKUP_METRIC_IDS = LOVAT_LOOKUP_METRICS.filter((metric) => metric.source === "scout").map(
  (metric) => metric.id,
);

const DRIVER_ABILITY_LABELS: Record<string, number> = {
  exceptional: 5,
  great: 4,
  average: 3,
  belowaverage: 2,
  poor: 1,
};

const DEFENSE_EFFECTIVENESS_LABELS: Record<string, number> = {
  great: 5,
  good: 4,
  average: 3,
  poor: 2,
  terrible: 1,
};

const AUTO_CLIMB_LABELS: Record<string, number> = {
  succeeded: 1,
  success: 1,
  yes: 1,
  failed: 0.5,
  fail: 0.5,
  notattempted: 0,
  none: 0,
  no: 0,
};

const ACCURACY_LABELS: Record<string, number> = {
  "90100": 0.95,
  "8090": 0.85,
  "7080": 0.75,
  "6070": 0.65,
  "5060": 0.55,
  "50": 0.4,
};

function normalizeLookupKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function flattenPayloadValues(payload: Record<string, unknown>): Map<string, unknown> {
  const index = new Map<string, unknown>();
  const put = (norm: string, value: unknown) => {
    if (!norm || index.has(norm)) return;
    index.set(norm, value);
  };
  for (const [key, value] of Object.entries(payload)) {
    put(normalizeLookupKey(key), value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [innerKey, inner] of Object.entries(value as Record<string, unknown>)) {
        put(normalizeLookupKey(`${key}${innerKey}`), inner);
      }
    }
  }
  return index;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (Array.isArray(value)) {
    const parts = value.map(asFiniteNumber).filter((part): part is number => part != null);
    if (parts.length === 0) return null;
    return parts.reduce((sum, part) => sum + part, 0);
  }
  return null;
}

function firstNumber(index: Map<string, unknown>, aliases: readonly string[]): number | null {
  for (const alias of aliases) {
    const value = asFiniteNumber(index.get(normalizeLookupKey(alias)));
    if (value != null) return value;
  }
  return null;
}

function firstPresent(index: Map<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    const key = normalizeLookupKey(alias);
    if (index.has(key)) return index.get(key);
  }
  return undefined;
}

function labelToNumber(value: unknown, table: Record<string, number>): number | null {
  if (typeof value !== "string") return null;
  const norm = normalizeLookupKey(value);
  if (table[norm] != null) return table[norm]!;
  for (const [key, mapped] of Object.entries(table)) {
    if (norm.includes(key)) return mapped;
  }
  return null;
}

function truthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (typeof value !== "string") return false;
  const norm = value.trim().toLowerCase();
  return norm !== "" && !["no", "false", "none", "0", "n/a"].includes(norm);
}

function sumPresent(parts: Array<number | null>): number | null {
  const finite = parts.filter((part): part is number => part != null && Number.isFinite(part));
  if (finite.length === 0) return null;
  return finite.reduce((sum, part) => sum + part, 0);
}

function rateFromCountAndDuration(count: number | null, durationSeconds: number | null): number | null {
  if (count == null || durationSeconds == null || durationSeconds <= 0) return null;
  return count / durationSeconds;
}

/**
 * One Collection-style payload → the scout half of the 22 lookup metrics.
 * Counts, timers, and qualitative answers stay blank when those keys are absent.
 * Rates need an explicit rate or a stored duration — match length is never invented.
 */
export function scoutMetricsFromPayload(
  payload: Record<string, unknown> | null | undefined,
): Partial<Record<LovatLookupMetricId, number | null>> {
  if (!payload || typeof payload !== "object") return {};
  const index = flattenPayloadValues(payload);

  const driverAbility =
    firstNumber(index, ["driverAbility", "driver_ability", "driver_skill"]) ??
    labelToNumber(firstPresent(index, ["driverAbility", "driver_ability", "driver_skill"]), DRIVER_ABILITY_LABELS);

  const autoClimb =
    firstNumber(index, ["autoClimb", "auto_climb"]) ??
    labelToNumber(firstPresent(index, ["autoClimb", "auto_climb"]), AUTO_CLIMB_LABELS);

  const defenseEffectiveness =
    firstNumber(index, ["defenseEffectiveness", "defense_effectiveness", "defense_rating", "defense"]) ??
    labelToNumber(
      firstPresent(index, ["defenseEffectiveness", "defense_effectiveness", "defense_rating"]),
      DEFENSE_EFFECTIVENESS_LABELS,
    );

  const contactDefenseTime = firstNumber(index, ["contactDefenseTime", "contact_defense", "contact_defense_time"]);
  const campingDefenseTime = firstNumber(index, ["campingDefenseTime", "camping", "camping_defense_time"]);
  const totalDefenseTime =
    firstNumber(index, ["totalDefenseTime", "defenseTime", "defense_time", "total_defense_time"]) ??
    sumPresent([contactDefenseTime, campingDefenseTime]);

  const autoFuel = firstNumber(index, ["auto_fuel", "autoFuel"]);
  const teleopFuel = firstNumber(index, ["teleop_fuel", "teleopFuel"]);
  const estimatedTotalFuelScored =
    firstNumber(index, ["estimatedTotalFuelScored", "fuel_scored", "fuelScored"]) ??
    sumPresent([autoFuel, teleopFuel]);
  const totalFuelFed = firstNumber(index, ["totalFuelFed", "fuel_passed", "fuelPassed", "fed"]);
  const totalFuelThroughput =
    firstNumber(index, ["totalFuelThroughput", "throughput"]) ??
    sumPresent([estimatedTotalFuelScored, totalFuelFed]);

  const scoringDuration = firstNumber(index, ["scoringTime", "scoring_time", "shoot_time", "shootDuration"]);
  const feedingDuration = firstNumber(index, ["feedingTime", "feeding_time", "feed_duration"]);
  const scoringRate =
    firstNumber(index, ["scoringRate", "scoring_rate", "cycle_rate"]) ??
    rateFromCountAndDuration(estimatedTotalFuelScored, scoringDuration);
  const feedingRate =
    firstNumber(index, ["feedingRate", "feeding_rate", "feed_rate"]) ??
    rateFromCountAndDuration(totalFuelFed, feedingDuration);

  const accuracy =
    firstNumber(index, ["estimatedSuccessfulFuelRate", "success_rate", "accuracy"]) ??
    labelToNumber(firstPresent(index, ["accuracy", "shot_accuracy", "shotAccuracy"]), ACCURACY_LABELS);
  const estimatedSuccessfulFuelRate = accuracy;

  const explicitReliability = firstNumber(index, ["reliability"]);
  const failure = firstPresent(index, [
    "disabled",
    "breakdown",
    "noShow",
    "no_show",
    "robotBroke",
    "robot_broke",
    "broke",
  ]);
  const reliability =
    explicitReliability != null
      ? explicitReliability
      : failure === undefined
        ? null
        : truthyFlag(failure)
          ? 0
          : 1;

  return {
    driverAbility,
    autoClimb,
    defenseEffectiveness,
    contactDefenseTime,
    campingDefenseTime,
    totalDefenseTime,
    totalFuelThroughput,
    totalFuelFed,
    feedingRate,
    scoringRate,
    estimatedSuccessfulFuelRate,
    estimatedTotalFuelScored,
    reliability,
  };
}

export function averageScoutMetric(
  rows: Array<Record<string, unknown>>,
  keys: string[],
): number | null {
  const values: number[] = [];
  for (const row of rows) {
    const derived = scoutMetricsFromPayload(row);
    let found: number | null = null;
    for (const key of keys) {
      const fromDerived = derived[key as LovatLookupMetricId];
      if (typeof fromDerived === "number" && Number.isFinite(fromDerived)) {
        found = fromDerived;
        break;
      }
      const value = row[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        found = value;
        break;
      }
    }
    if (found != null) values.push(found);
  }
  return populationMean(values);
}

export function scoutAveragesFromPayloads(
  teamKey: string,
  payloads: Array<Record<string, unknown>>,
): ScoutAverageRow | null {
  if (payloads.length === 0) return null;
  const perMatch = payloads.map((payload) => scoutMetricsFromPayload(payload));
  const values: ScoutAverageRow["values"] = {};
  for (const id of SCOUT_LOOKUP_METRIC_IDS) {
    const numbers = perMatch
      .map((row) => row[id])
      .filter((value): value is number => value != null && Number.isFinite(value));
    values[id] = populationMean(numbers);
  }
  return { teamKey, values, sample: payloads.length };
}

export function scoutSeriesFromPayloads(
  payloads: Array<Record<string, unknown>>,
): Partial<Record<LovatLookupMetricId, Array<number | null>>> {
  const series: Partial<Record<LovatLookupMetricId, Array<number | null>>> = {};
  for (const id of SCOUT_LOOKUP_METRIC_IDS) {
    series[id] = payloads.map((payload) => scoutMetricsFromPayload(payload)[id] ?? null);
  }
  return series;
}

export function scoutAveragesByTeam(
  rows: Array<{ teamKey: string; payload: Record<string, unknown> | null | undefined }>,
): ScoutAverageRow[] {
  const byTeam = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const list = byTeam.get(row.teamKey) ?? [];
    list.push(row.payload && typeof row.payload === "object" ? row.payload : {});
    byTeam.set(row.teamKey, list);
  }
  return [...byTeam.entries()]
    .map(([teamKey, payloads]) => scoutAveragesFromPayloads(teamKey, payloads))
    .filter((row): row is ScoutAverageRow => row != null);
}

export function fieldStatsFromScoutRows(rows: ScoutAverageRow[]): LookupFieldStats {
  const picklist = fieldStatsFromRows(
    rows.map((row) => ({
      teamKey: row.teamKey,
      values: row.values,
    })),
  );
  const extra: LookupFieldStats = { ...picklist };
  const reliabilityValues = rows
    .map((row) => row.values.reliability)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const mean = populationMean(reliabilityValues);
  const std = populationStdDev(reliabilityValues);
  if (mean != null && std != null) {
    extra.reliability = { mean, std, n: reliabilityValues.length };
  }
  return extra;
}

export function mergeLookupFieldStats(...parts: LookupFieldStats[]): LookupFieldStats {
  return Object.assign({}, ...parts);
}

export function eventStdFor(id: LovatLookupMetricId, rows: EventRatingRow[]): number | null {
  const mapped = eventRowsToMetricRows(rows);
  return populationStdDev(mapped.map((row) => row.values[id as PicklistMetricId] ?? null).filter((value): value is number => value != null));
}
