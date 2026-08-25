/**
 * Pure helpers for the platform-owner analytics cockpit (`/admin/analytics`).
 * Every series is computed from real rows the API route read — these helpers
 * only reshape; they never invent, extrapolate, or backfill fake activity.
 */

export type DayCount = { day: string; value: number };

export type ActivityRow = {
  orgId: string;
  day: string;
  source: string;
  events: number;
};

export type AiDailyRow = {
  day: string;
  keySource: string;
  calls: number;
  tokens: number;
  costUsd: number;
};

export type AiKeyGroup = "hosted" | "byok" | "local" | "subscription" | "other";

export type HistogramBucket = { label: string; orgs: number };

/** UTC calendar day (YYYY-MM-DD) for a Date. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** UTC day string `offsetDays` before `end` (0 = end itself). */
export function dayBefore(end: string, offsetDays: number): string {
  const parsed = new Date(`${end}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - offsetDays);
  return utcDay(parsed);
}

/**
 * Dense day axis ending at `end` (inclusive), `days` entries long. Missing days
 * are real zeros — a day with no rows genuinely had no activity.
 */
export function fillDailySeries(
  rows: Iterable<{ day: string; value: number }>,
  end: string,
  days: number,
): DayCount[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (!row.day) continue;
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + safeCount(row.value));
  }
  const series: DayCount[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = dayBefore(end, offset);
    series.push({ day, value: byDay.get(day) ?? 0 });
  }
  return series;
}

/** Sum activity rows into one value per day (all orgs, all sources). */
export function sumEventsByDay(rows: ActivityRow[]): { day: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + safeCount(row.events));
  }
  return [...byDay.entries()].map(([day, value]) => ({ day, value }));
}

/** Sum activity rows per source, descending. */
export function sumEventsBySource(rows: ActivityRow[]): { source: string; events: number }[] {
  const bySource = new Map<string, number>();
  for (const row of rows) {
    bySource.set(row.source, (bySource.get(row.source) ?? 0) + safeCount(row.events));
  }
  return [...bySource.entries()]
    .map(([source, events]) => ({ source, events }))
    .sort((a, b) => b.events - a.events);
}

/** Orgs with at least one event on/after `sinceDay`. */
export function activeOrgIds(rows: ActivityRow[], sinceDay: string): Set<string> {
  const active = new Set<string>();
  for (const row of rows) {
    if (row.day >= sinceDay && safeCount(row.events) > 0) active.add(row.orgId);
  }
  return active;
}

/** Distinct active days per org across the whole window. */
export function daysActiveByOrg(rows: ActivityRow[]): Map<string, number> {
  const days = new Map<string, Set<string>>();
  for (const row of rows) {
    if (safeCount(row.events) <= 0) continue;
    const set = days.get(row.orgId) ?? new Set<string>();
    set.add(row.day);
    days.set(row.orgId, set);
  }
  return new Map([...days.entries()].map(([orgId, set]) => [orgId, set.size]));
}

/** Latest active day per org, or undefined when the org never showed activity. */
export function lastActiveByOrg(rows: ActivityRow[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const row of rows) {
    if (safeCount(row.events) <= 0) continue;
    const current = last.get(row.orgId);
    if (!current || row.day > current) last.set(row.orgId, row.day);
  }
  return last;
}

/** Top event source per org (for the org table's "feature mix" hint). */
export function topSourceByOrg(rows: ActivityRow[]): Map<string, string> {
  const totals = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const perSource = totals.get(row.orgId) ?? new Map<string, number>();
    perSource.set(row.source, (perSource.get(row.source) ?? 0) + safeCount(row.events));
    totals.set(row.orgId, perSource);
  }
  const top = new Map<string, string>();
  for (const [orgId, perSource] of totals) {
    let bestSource = "";
    let bestCount = -1;
    for (const [source, count] of perSource) {
      if (count > bestCount) {
        bestCount = count;
        bestSource = source;
      }
    }
    if (bestSource) top.set(orgId, bestSource);
  }
  return top;
}

const HISTOGRAM_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "0 days", min: 0, max: 0 },
  { label: "1–2 days", min: 1, max: 2 },
  { label: "3–7 days", min: 3, max: 7 },
  { label: "8–15 days", min: 8, max: 15 },
  { label: "16–30 days", min: 16, max: 30 },
  { label: "31+ days", min: 31, max: Number.POSITIVE_INFINITY },
];

/**
 * Days-active histogram across every provisioned org. `totalOrgs` keeps the
 * zero bucket honest: provisioned orgs with no activity in the window count
 * as "0 days" instead of vanishing.
 */
export function daysActiveHistogram(
  daysActive: Iterable<number>,
  totalOrgs: number,
): HistogramBucket[] {
  const buckets = HISTOGRAM_BUCKETS.map((bucket) => ({ label: bucket.label, orgs: 0 }));
  let counted = 0;
  for (const days of daysActive) {
    const value = safeCount(days);
    counted += 1;
    const index = HISTOGRAM_BUCKETS.findIndex((b) => value >= b.min && value <= b.max);
    buckets[Math.max(0, index)]!.orgs += 1;
  }
  const idle = Math.max(0, Math.floor(totalOrgs) - counted);
  buckets[0]!.orgs += idle;
  return buckets;
}

/** Map a raw ai_usage_events.key_source onto the hosted / BYOK / local split. */
export function keySourceGroup(keySource: string): AiKeyGroup {
  switch (keySource) {
    case "platform":
    case "sponsored":
      return "hosted";
    case "byo":
      return "byok";
    case "local":
    case "local_cli":
      return "local";
    case "subscription_bridge":
      return "subscription";
    default:
      return "other";
  }
}

export type AiGroupTotals = {
  group: AiKeyGroup;
  calls: number;
  tokens: number;
  costUsd: number;
};

/** Collapse per-day/per-key-source AI rows into hosted / BYOK / local totals. */
export function aiTotalsByGroup(rows: AiDailyRow[]): AiGroupTotals[] {
  const byGroup = new Map<AiKeyGroup, AiGroupTotals>();
  for (const row of rows) {
    const group = keySourceGroup(row.keySource);
    const entry = byGroup.get(group) ?? { group, calls: 0, tokens: 0, costUsd: 0 };
    entry.calls += safeCount(row.calls);
    entry.tokens += safeCount(row.tokens);
    entry.costUsd += safeMoney(row.costUsd);
    byGroup.set(group, entry);
  }
  const order: AiKeyGroup[] = ["hosted", "byok", "local", "other"];
  return order
    .map((group) => byGroup.get(group))
    .filter((entry): entry is AiGroupTotals => Boolean(entry))
    .map((entry) => ({ ...entry, costUsd: roundMoney(entry.costUsd) }));
}

/** Collapse per-day/per-key-source AI rows into one row per day. */
export function aiDailySeries(
  rows: AiDailyRow[],
  end: string,
  days: number,
): Array<{ day: string; calls: number; tokens: number; costUsd: number }> {
  const byDay = new Map<string, { calls: number; tokens: number; costUsd: number }>();
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { calls: 0, tokens: 0, costUsd: 0 };
    entry.calls += safeCount(row.calls);
    entry.tokens += safeCount(row.tokens);
    entry.costUsd += safeMoney(row.costUsd);
    byDay.set(row.day, entry);
  }
  const series: Array<{ day: string; calls: number; tokens: number; costUsd: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = dayBefore(end, offset);
    const entry = byDay.get(day) ?? { calls: 0, tokens: 0, costUsd: 0 };
    series.push({ day, calls: entry.calls, tokens: entry.tokens, costUsd: roundMoney(entry.costUsd) });
  }
  return series;
}

/** Defensive integer: NaN / negative / non-finite inputs count as zero. */
export function safeCount(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

/** Defensive money: NaN / negative / non-finite inputs count as zero dollars. */
export function safeMoney(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/** Round to micro-dollar-safe cents-of-cents (ledger precision is 6dp). */
export function roundMoney(value: number): number {
  return Math.round(safeMoney(value) * 1e6) / 1e6;
}

/** Display USD honestly: real zeros stay "$0.00"; sub-cent spend stays visible. */
export function formatUsd(value: number): string {
  const amount = safeMoney(value);
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact token/event counts for tiles (1.2k / 3.4M); exact below 1000. */
export function formatCount(value: number): string {
  const count = safeCount(value);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}
