/**
 * What our own scouting says about one robot, built from whatever the team's
 * form actually collects.
 *
 * The lookup board used to average a fixed list of one season's field names
 * (fuel fed, camping defense time…). A team whose form asks for `teleopCycles`
 * and `endgame` got thirteen tiles reading "Needs setup — no scout rows yet"
 * beside fifteen real scout rows. This reads the rows instead of guessing the
 * schema: numbers become an average with a per-match trend, yes/no answers a
 * rate, short picks (climb / park / none) a split, and free text stays notes.
 *
 * Nothing is filled in: a field with no answers in any row is not shown.
 */

import { sparklinePath } from "../intel/lovat-lookup";
import { combineObservations, observationFields, type ObservationConflict } from "./observations";
import type { FieldDefinition } from "@vantage/scouting";

export type ScoutRow = {
  matchKey?: string | null;
  payload: Record<string, unknown>;
  fields?: FieldDefinition[];
};

export type MetricEvidence = {
  unit: string | null;
  definition: string;
  answered: number;
  missing: number;
  disagreements: number;
  samples: Array<{ match: string; matchKey: string | null; value: unknown; reports: unknown[] }>;
};

export type NumericBreakdown = {
  evidence: MetricEvidence;
  kind: "number";
  key: string;
  label: string;
  mean: number;
  min: number;
  max: number;
  /** Values in match order, for the trend line and the per-match list. */
  series: Array<{ match: string; value: number }>;
  sparkline: string | null;
  /** Last-three average minus the overall average; null under 4 matches. */
  recentDelta: number | null;
  /** Fouls, misses, drops: a falling number is the good news. */
  lowerIsBetter: boolean;
};

export type RateBreakdown = {
  evidence: MetricEvidence;
  kind: "rate";
  key: string;
  label: string;
  yes: number;
  total: number;
  rate: number;
  /** True when "yes" is the bad outcome (broke down, tipped, no-show). */
  yesIsBad: boolean;
};

export type SplitBreakdown = {
  evidence: MetricEvidence;
  kind: "split";
  key: string;
  label: string;
  total: number;
  options: Array<{ value: string; count: number; share: number }>;
};

export type FieldBreakdown = NumericBreakdown | RateBreakdown | SplitBreakdown;

export type ScoutBreakdown = {
  matches: number;
  fields: FieldBreakdown[];
  notes: Array<{ match: string; text: string }>;
  disagreements?: ObservationConflict[];
};

const NOTE_KEYS = new Set(["notes", "note", "comments", "comment", "observations"]);
const SKIP_KEYS = new Set(["team", "teamKey", "team_key", "match", "matchKey", "match_key", "scout", "event"]);
const BAD_YES = /broke|break|disabled|dead|tipp|no.?show|died|foul|card|stuck|lost/i;
const LOWER_IS_BETTER = /foul|penalt|card|miss|drop|fail|error/i;
const YES = new Set(["yes", "y", "true"]);
const NO = new Set(["no", "n", "false"]);

/** "autoPoints" → "Auto points", "teleop_cycles" → "Teleop cycles". */
export function fieldLabel(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `2026gacmp_qm6` → "Q6", `…_sf2m1` → "SF2-1", `…_f1m2` → "F-2".
 * Anything else is returned untouched rather than mangled.
 */
export function matchKeyLabel(matchKey: string | null | undefined): string {
  if (!matchKey) return "Pit";
  const tail = matchKey.includes("_") ? matchKey.slice(matchKey.lastIndexOf("_") + 1) : matchKey;
  const qual = /^qm(\d+)$/i.exec(tail);
  if (qual) return `Q${qual[1]}`;
  const playoff = /^(ef|qf|sf)(\d+)m(\d+)$/i.exec(tail);
  if (playoff) return `${(playoff[1] ?? "").toUpperCase()}${playoff[2]}-${playoff[3]}`;
  const final = /^f(\d+)m(\d+)$/i.exec(tail);
  if (final) return `F-${final[2]}`;
  return matchKey;
}

/** Sort order for match keys: quals by number, then playoffs, then finals. */
export function matchSortValue(matchKey: string | null | undefined): number {
  if (!matchKey) return Number.MAX_SAFE_INTEGER;
  const tail = matchKey.includes("_") ? matchKey.slice(matchKey.lastIndexOf("_") + 1) : matchKey;
  const qual = /^qm(\d+)$/i.exec(tail);
  if (qual) return Number(qual[1]);
  const playoff = /^(ef|qf|sf)(\d+)m(\d+)$/i.exec(tail);
  if (playoff) {
    const level = { ef: 1, qf: 2, sf: 3 }[(playoff[1] ?? "").toLowerCase() as "ef" | "qf" | "sf"] ?? 0;
    return 10_000 * level + 100 * Number(playoff[2]) + Number(playoff[3]);
  }
  const final = /^f(\d+)m(\d+)$/i.exec(tail);
  if (final) return 50_000 + Number(final[2]);
  return Number.MAX_SAFE_INTEGER - 1;
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function asYesNo(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (YES.has(text)) return true;
  if (NO.has(text)) return false;
  return null;
}

/**
 * Where a field sits on the board. Postgres stores payloads as jsonb, which
 * does not keep the order the form asked in, so the order is chosen here:
 * the scoring numbers a strategist looks at first, then the rest.
 */
function fieldRank(field: FieldBreakdown): number {
  const key = field.key.toLowerCase();
  if (field.kind === "number") {
    if (field.lowerIsBetter) return 40;
    if (/total|score|points?$/.test(key) && !/auto|tele|end/.test(key)) return 0;
    if (/auto/.test(key)) return 10;
    if (/tele|cycle/.test(key)) return 20;
    if (/end|climb|park/.test(key)) return 30;
    return 35;
  }
  return field.kind === "split" ? 50 : 60;
}

/** Build the breakdown for one team's scout rows. */
export function buildScoutBreakdown(rows: ScoutRow[]): ScoutBreakdown {
  // Lap arrays need explicit summaries, not array indexes treated as metrics.
  // Keep the original API payload untouched for the raw observation view/export.
  rows = rows.map(row => {
    const payload = { ...row.payload };
    const fields = [...(row.fields ?? [])];
    for (const field of row.fields ?? []) {
      const value = payload[field.key];
      if (field.type !== "timer" || field.config?.mode !== "lap" || !Array.isArray(value)) continue;
      delete payload[field.key];
      if (!value.every(lap => typeof lap === "number" && Number.isFinite(lap) && lap >= 0)) continue;
      const total = value.reduce((sum: number, lap: number) => sum + lap, 0);
      if (!Number.isFinite(total)) continue;
      payload[field.key] = { totalSeconds: total, lapCount: value.length, averageLapSeconds: value.length ? total / value.length : null };
      const label = field.label || fieldLabel(field.key);
      for (const [suffix, title, unit, explanation] of [
        ["totalSeconds", "Total time", "seconds", "Sum of recorded laps per report."],
        ["lapCount", "Recorded laps", "laps", "Number of recorded laps; an empty recorded list is zero."],
        ["averageLapSeconds", "Average lap", "seconds", "Mean recorded lap time per report; no laps means unknown, not zero."],
      ]) fields.push({ key: `${field.key}.${suffix}`, label: `${label} · ${title}`, type: "number",
        config: { unit }, helpText: `${explanation} Reports are combined within each match before matches receive equal weight.` });
    }
    return { ...row, payload, fields };
  });
  const combined = combineObservations(rows);
  const sorted = combined.rows.sort((a, b) => matchSortValue(a.matchKey) - matchSortValue(b.matchKey));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    for (const key of Object.keys(row.payload ?? {})) {
      if (seen.has(key) || SKIP_KEYS.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
  }

  const fields: FieldBreakdown[] = [];
  const notes: ScoutBreakdown["notes"] = [];
  const definitions = new Map(rows.flatMap(row => row.fields ?? []).map(field => [field.key, field]));
  const selections = new Map<string,Set<string>>();
  for (const row of rows) for (const [key,value] of Object.entries(row.payload)) {
    if (Array.isArray(value) && value.every(item => typeof item === "string")) {
      const options = selections.get(key) ?? new Set<string>(); value.forEach(item => options.add(item)); selections.set(key,options);
    }
  }
  const raw = rows.map(row => ({ ...row, flat: observationFields(row.payload,selections) }));
  const reportsByMatch = new Map<string | null | undefined, typeof raw>();
  for (const row of raw) {
    const reports = reportsByMatch.get(row.matchKey) ?? [];
    reports.push(row); reportsByMatch.set(row.matchKey,reports);
  }
  const isNote = (key: string) => NOTE_KEYS.has(key.toLowerCase()) || ["text","long_text","short_answer"].includes(definitions.get(key)?.type ?? "");

  for (const row of rows) {
    for (const [key, value] of Object.entries(row.payload)) {
      if (isNote(key) && typeof value === "string" && value.trim()) {
        notes.push({ match: matchKeyLabel(row.matchKey), text: value.trim() });
      }
    }
  }

  for (const key of order) {
    if (isNote(key)) {
      continue;
    }

    const numbers: Array<{ match: string; value: number }> = [];
    const flags: boolean[] = [];
    const words: string[] = [];
    for (const row of sorted) {
      const raw = row.payload[key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        numbers.push({ match: matchKeyLabel(row.matchKey), value: raw });
        continue;
      }
      const flag = asYesNo(raw);
      if (flag != null) {
        flags.push(flag);
        continue;
      }
      if (typeof raw === "string" && raw.trim() && raw.trim().length <= 24) {
        words.push(raw.trim().toLowerCase());
      }
    }

    const definition = definitions.get(key) ?? definitions.get(key.split(".")[0]!);
    // A grid cell is a location, never a scoring average. Paths remain raw observations.
    if (definition?.type === "field_position" || definition?.type === "auto_path") continue;
    const label = definition?.label ? `${definition.label}${key.includes(".") && definition.key !== key ? ` · ${fieldLabel(key.split(".").slice(1).join(" "))}` : ""}` : fieldLabel(key);
    const evidence: MetricEvidence = {
      unit: definition?.type === "timer" ? "seconds" : typeof definition?.config?.unit === "string" ? definition.config.unit : null,
      definition: definition?.helpText?.trim() || `Recorded answers for ${label.toLowerCase()} in the scouting form.`,
      answered: 0,
      missing: 0,
      disagreements: combined.conflicts.filter(conflict => conflict.field === key).length,
      samples: sorted.map(row => ({
        match: matchKeyLabel(row.matchKey), matchKey: row.matchKey ?? null,
        value: row.payload[key] ?? null,
        reports: (reportsByMatch.get(row.matchKey) ?? [])
          .map(report => report.flat[key]).filter(value => value !== null && value !== undefined && value !== ""),
      })),
    };
    if (numbers.length > 0 && numbers.length >= flags.length && numbers.length >= words.length) {
      const values = numbers.map((point) => point.value);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const recent = values.slice(-3);
      const recentMean = recent.reduce((sum, value) => sum + value, 0) / recent.length;
      fields.push({
        evidence: { ...evidence, answered: numbers.length, missing: sorted.length - numbers.length },
        kind: "number",
        key,
        label,
        mean: round(mean),
        min: Math.min(...values),
        max: Math.max(...values),
        series: numbers,
        sparkline: sparklinePath(values),
        recentDelta: values.length >= 4 ? round(recentMean - mean) : null,
        lowerIsBetter: LOWER_IS_BETTER.test(key),
      });
    } else if (flags.length > 0 && flags.length >= words.length) {
      const yes = flags.filter(Boolean).length;
      fields.push({
        evidence: { ...evidence, answered: flags.length, missing: sorted.length - flags.length },
        kind: "rate",
        key,
        label,
        yes,
        total: flags.length,
        rate: round(yes / flags.length, 3),
        yesIsBad: BAD_YES.test(key),
      });
    } else if (words.length > 0) {
      const counts = new Map<string, number>();
      for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
      // Free text that happens to be short is not a pick list: a split with
      // as many options as answers says nothing.
      if (counts.size > 6 || (counts.size === words.length && words.length > 3)) continue;
      fields.push({
        evidence: { ...evidence, answered: words.length, missing: sorted.length - words.length },
        kind: "split",
        key,
        label,
        total: words.length,
        options: [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([value, count]) => ({ value, count, share: round(count / words.length, 3) })),
      });
    }
  }

  fields.sort((a, b) => fieldRank(a) - fieldRank(b));
  return { matches: sorted.filter((row) => row.matchKey).length, fields, notes,
    ...(combined.conflicts.some((item) => !isNote(item.field)) ? {
      disagreements: combined.conflicts.filter((item) => !isNote(item.field)),
    } : {}) };
}
