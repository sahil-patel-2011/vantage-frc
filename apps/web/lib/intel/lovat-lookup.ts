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
}): LookupCard[] {
  const eventValues = input.event ? ratingToMetricValues(input.event) : {};
  const scoutValues = input.scout?.values ?? {};
  return LOVAT_LOOKUP_METRICS.map((metric) => {
    const value = metric.source === "event" ? (eventValues[metric.id] ?? null) : (scoutValues[metric.id] ?? null);
    const stat = input.field[metric.id];
    const compare = fieldCompare(value, stat?.mean ?? null, stat?.std ?? null, invertBetter.has(metric.id));
    const contribution = invertBetter.has(metric.id) ? null : contributionShare(value, stat?.mean ?? null);
    const spark = metric.id === "totalPoints" ? sparklinePath(input.history ?? []) : null;
    return {
      id: metric.id,
      label: metric.label,
      source: metric.source,
      detail: metric.source === "scout" && value == null ? "Needs setup — no scout rows yet" : metric.detail,
      value,
      display: formatLookupValue(value, metric.id === "rank" || metric.id === "wins" ? 0 : 1),
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

export function averageScoutMetric(
  rows: Array<Record<string, unknown>>,
  keys: string[],
): number | null {
  const values: number[] = [];
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "number" && Number.isFinite(value)) values.push(value);
    }
  }
  return populationMean(values);
}

export function scoutAveragesFromPayloads(
  teamKey: string,
  payloads: Array<Record<string, unknown>>,
): ScoutAverageRow | null {
  if (payloads.length === 0) return null;
  const values: ScoutAverageRow["values"] = {
    driverAbility: averageScoutMetric(payloads, ["driverAbility", "driver", "driver_skill"]),
    autoClimb: averageScoutMetric(payloads, ["autoClimb", "auto_climb"]),
    defenseEffectiveness: averageScoutMetric(payloads, ["defenseEffectiveness", "defense", "defense_rating"]),
    contactDefenseTime: averageScoutMetric(payloads, ["contactDefenseTime", "contact_defense"]),
    campingDefenseTime: averageScoutMetric(payloads, ["campingDefenseTime", "camping"]),
    totalDefenseTime: averageScoutMetric(payloads, ["totalDefenseTime", "defenseTime", "defense_time"]),
    totalFuelThroughput: averageScoutMetric(payloads, ["totalFuelThroughput", "throughput"]),
    totalFuelFed: averageScoutMetric(payloads, ["totalFuelFed", "fed"]),
    feedingRate: averageScoutMetric(payloads, ["feedingRate", "feed_rate"]),
    scoringRate: averageScoutMetric(payloads, ["scoringRate", "cycle_rate"]),
    estimatedSuccessfulFuelRate: averageScoutMetric(payloads, ["estimatedSuccessfulFuelRate", "success_rate"]),
    estimatedTotalFuelScored: averageScoutMetric(payloads, ["estimatedTotalFuelScored", "fuel_scored"]),
    reliability: averageScoutMetric(payloads, ["reliability"]),
  };
  const any = Object.values(values).some((value) => value != null);
  if (!any) return { teamKey, values, sample: payloads.length };
  return { teamKey, values, sample: payloads.length };
}

export function eventStdFor(id: LovatLookupMetricId, rows: EventRatingRow[]): number | null {
  const mapped = eventRowsToMetricRows(rows);
  return populationStdDev(mapped.map((row) => row.values[id as PicklistMetricId] ?? null).filter((value): value is number => value != null));
}
