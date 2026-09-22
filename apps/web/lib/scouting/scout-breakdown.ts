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

export type ScoutRow = {
  matchKey?: string | null;
  payload: Record<string, unknown>;
};

export type NumericBreakdown = {
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
  const sorted = [...rows].sort((a, b) => matchSortValue(a.matchKey) - matchSortValue(b.matchKey));
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

  for (const key of order) {
    if (NOTE_KEYS.has(key.toLowerCase())) {
      for (const row of sorted) {
        const text = row.payload[key];
        if (typeof text === "string" && text.trim()) {
          notes.push({ match: matchKeyLabel(row.matchKey), text: text.trim() });
        }
      }
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

    const label = fieldLabel(key);
    if (numbers.length > 0 && numbers.length >= flags.length && numbers.length >= words.length) {
      const values = numbers.map((point) => point.value);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const recent = values.slice(-3);
      const recentMean = recent.reduce((sum, value) => sum + value, 0) / recent.length;
      fields.push({
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
  return { matches: sorted.filter((row) => row.matchKey).length, fields, notes };
}
