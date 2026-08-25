/**
 * Team journal — the shape the dream ledger takes on screen, plus the pure
 * formatting the client and the API both rely on.
 *
 * Every helper here renders ONLY what a run actually recorded. A source with a
 * zero (or missing) count produces no chip; a day with no run produces no
 * entry. Nothing is filled in, estimated, or back-dated.
 *
 * Pure: no DB, no fetch, no clock reads.
 */

import { formatHours, type DreamDigest } from "./compute-dream";

export type DreamRunStatus = "ok" | "no_activity" | "no_ai_fallback" | "error";
export type DreamRunKind = "daily" | "weekly";

/**
 * Counts snapshotted from the digest at run time and stored on the run row, so
 * the journal can show "what fed this entry" without re-reading raw tables (or
 * parsing the recap text back out).
 */
export type DreamSourceCounts = Partial<Record<DreamSourceKey, number>>;

export const DREAM_SOURCE_KEYS = [
  "messages",
  "scouting",
  "tasks",
  "decisions",
  "calendarEvents",
  "incidents",
  "cadJobs",
  "hours",
  "predictions",
  "matches",
  "bugs",
  "grantDeadlines",
] as const;

export type DreamSourceKey = (typeof DREAM_SOURCE_KEYS)[number];

/** Singular/plural noun per source. `hours` formats as a decimal, not a count. */
const SOURCE_LABELS: Record<DreamSourceKey, { one: string; many: string }> = {
  messages: { one: "message", many: "messages" },
  scouting: { one: "scout entry", many: "scout entries" },
  tasks: { one: "task done", many: "tasks done" },
  decisions: { one: "decision", many: "decisions" },
  calendarEvents: { one: "event held", many: "events held" },
  incidents: { one: "incident", many: "incidents" },
  cadJobs: { one: "CAD job", many: "CAD jobs" },
  hours: { one: "hour logged", many: "hours logged" },
  predictions: { one: "call", many: "calls" },
  matches: { one: "match", many: "matches" },
  bugs: { one: "bug filed", many: "bugs filed" },
  grantDeadlines: { one: "deadline near", many: "deadlines near" },
};

export type DreamJournalEntry = {
  /** YYYY-MM-DD (UTC) the run is filed under. */
  day: string;
  kind: DreamRunKind;
  status: DreamRunStatus;
  /** ISO timestamp of the attempt. */
  ranAt: string;
  /** The stored memory text — null for no_activity and error days. */
  content: string | null;
  /** Whether the memory row is still live (not expired, not disabled). */
  memoryLive: boolean;
  errorClass: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  sourceCounts: DreamSourceCounts;
};

export type DreamJournalPage = {
  entries: DreamJournalEntry[];
  /** Pass back as `?before=` to page further into the season. */
  nextCursor: string | null;
  retentionDays: number;
  memoryEnabled: boolean;
  canRunNow: boolean;
  /** ISO timestamp of the most recent attempt of any kind, or null. */
  lastRunAt: string | null;
};

/**
 * Snapshot the counts a digest actually produced. Zero-valued sources are left
 * OUT of the object entirely — an absent key means "recorded nothing", which is
 * exactly what the journal should show (no chip), and it keeps the stored jsonb
 * small on quiet days.
 */
export function digestSourceCounts(digest: DreamDigest): DreamSourceCounts {
  const counts: DreamSourceCounts = {};
  const put = (key: DreamSourceKey, value: number) => {
    if (Number.isFinite(value) && value > 0) counts[key] = value;
  };
  put("messages", digest.messages.count);
  put("scouting", digest.scouting.total);
  put("tasks", digest.tasksCompleted.count);
  put("decisions", digest.decisions.count);
  put("calendarEvents", digest.calendarEvents.count);
  put("incidents", digest.incidents.openedCount + digest.incidents.resolvedCount);
  put("cadJobs", digest.cadJobs.count);
  put("hours", Math.round(digest.hours.totalHours * 10) / 10);
  put("predictions", digest.predictions.calls);
  put("matches", digest.matchResults.items.length);
  put("bugs", digest.bugs.count);
  put("grantDeadlines", digest.grantDeadlines.count);
  return counts;
}

/** Add up several days' snapshots — used for a week roll-up's chips. */
export function sumSourceCounts(all: Array<DreamSourceCounts | null | undefined>): DreamSourceCounts {
  const total: DreamSourceCounts = {};
  for (const counts of all) {
    if (!counts) continue;
    for (const key of DREAM_SOURCE_KEYS) {
      const value = counts[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      total[key] = (total[key] ?? 0) + value;
    }
  }
  for (const key of DREAM_SOURCE_KEYS) {
    if (key === "hours" && total.hours !== undefined) {
      total.hours = Math.round(total.hours * 10) / 10;
    }
  }
  return total;
}

/** Narrow untrusted jsonb from the ledger to the keys the journal renders. */
export function parseSourceCounts(raw: unknown): DreamSourceCounts {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const counts: DreamSourceCounts = {};
  for (const key of DREAM_SOURCE_KEYS) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) counts[key] = value;
  }
  return counts;
}

export type DreamSourceChip = { id: DreamSourceKey; label: string };

/** Chips for every source that actually contributed. Zero/missing → no chip. */
export function sourceChips(counts: DreamSourceCounts | null | undefined): DreamSourceChip[] {
  if (!counts) return [];
  const chips: DreamSourceChip[] = [];
  for (const key of DREAM_SOURCE_KEYS) {
    const raw = counts[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    const label = SOURCE_LABELS[key];
    if (key === "hours") {
      const value = formatHours(raw);
      chips.push({ id: key, label: `${value} ${value === "1" ? label.one : label.many}` });
      continue;
    }
    const value = Math.round(raw);
    chips.push({ id: key, label: `${value} ${value === 1 ? label.one : label.many}` });
  }
  return chips;
}

/** Weekday + date, e.g. "Saturday, 22 Aug 2026". Pure — parsed as UTC. */
export function formatJournalDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function journalEntryTitle(entry: DreamJournalEntry): string {
  if (entry.kind === "weekly") return `Week ending ${formatJournalDay(entry.day)}`;
  return formatJournalDay(entry.day);
}

/**
 * The one-line honest status for a run. `ok` days speak for themselves through
 * their content, so they get no status line.
 */
export function statusLine(entry: DreamJournalEntry): string | null {
  switch (entry.status) {
    case "ok":
      return null;
    case "no_activity":
      return entry.kind === "weekly"
        ? "Not enough daily entries this week to summarise — nothing was written."
        : "No recorded activity this day, so nothing was written to team memory.";
    case "no_ai_fallback":
      return "No AI summary available — the recorded facts are listed exactly as logged.";
    case "error":
      return entry.errorClass
        ? `The run failed (${entry.errorClass}). Nothing was written for this day.`
        : "The run failed. Nothing was written for this day.";
    default:
      return null;
  }
}

export type DreamErrorStreak = {
  /** Consecutive most-recent days that ended in `error`. */
  count: number;
  /** The error class from the most recent failure, when one was recorded. */
  errorClass: string | null;
  /** Oldest day in the streak (YYYY-MM-DD). */
  since: string;
  /** Newest day in the streak (YYYY-MM-DD). */
  latest: string;
};

/**
 * Consecutive failing days at the top of the ledger. Weekly rows are skipped —
 * they ride along with a daily run and would otherwise break an unrelated
 * daily streak in half.
 *
 * `entries` must be newest-first (the order the API returns).
 */
export function errorStreak(entries: DreamJournalEntry[]): DreamErrorStreak | null {
  const daily = entries.filter((entry) => entry.kind === "daily");
  let count = 0;
  let errorClass: string | null = null;
  let since = "";
  let latest = "";
  for (const entry of daily) {
    if (entry.status !== "error") break;
    if (count === 0) {
      errorClass = entry.errorClass;
      latest = entry.day;
    }
    since = entry.day;
    count += 1;
  }
  if (count < 2) return null;
  return { count, errorClass, since, latest };
}

/** What an owner should check when nights keep failing. Ordered by likelihood. */
export function errorStreakChecklist(errorClass: string | null): string[] {
  const checks: string[] = [];
  const kind = (errorClass ?? "").toLowerCase();
  if (kind.includes("noorgmembers")) {
    checks.push("This org has no members to attribute the run to — invite an owner.");
    return checks;
  }
  if (kind.includes("budget") || kind.includes("cap") || kind.includes("credit") || kind.includes("quota")) {
    checks.push("An AI budget cap is denying the call — raise or reset the cap under AI → Budgets.");
  }
  checks.push("Confirm a working model key under AI → API keys (org BYOK, member key, or the sponsored pool).");
  checks.push("Check the monthly cap and per-feature limits under AI → Budgets.");
  checks.push("Confirm team memory is still enabled below — a disabled team is skipped entirely.");
  return checks;
}

/** The retention sentence shown above the journal. Never guesses a number. */
export function retentionNotice(retentionDays: number): string {
  const days = Math.max(1, Math.round(retentionDays));
  return `Journal entries older than ${days} ${days === 1 ? "day" : "days"} expire and stop being injected into prompts, per your team memory retention setting below.`;
}
