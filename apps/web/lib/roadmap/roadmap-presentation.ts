/**
 * How the roadmap talks about time and status. Pure so the wording is testable —
 * the phrasing matters here: "overdue" must never sound like Vantage knows a FIRST
 * deadline, only that the window the team's own kickoff date implies has passed.
 */
import type { TaskUrgency } from "./season-roadmap";
import type { RoadmapOwnerRole } from "./season-roadmap";
import { OWNER_ROLE_LABELS, daysBetween } from "./season-roadmap";

export type UrgencyTone = "critical" | "warning" | "accent" | "muted" | "positive";

export const URGENCY_LABELS: Record<TaskUrgency, string> = {
  overdue: "Window passed",
  now: "Do this now",
  soon: "Coming up",
  later: "Later",
  undated: "No date yet",
  done: "Done",
  skipped: "Skipped",
};

export const URGENCY_TONES: Record<TaskUrgency, UrgencyTone> = {
  overdue: "critical",
  now: "warning",
  soon: "accent",
  later: "muted",
  undated: "muted",
  done: "positive",
  skipped: "muted",
};

const TONE_VARS: Record<UrgencyTone, string> = {
  critical: "var(--app-critical)",
  warning: "var(--app-warning)",
  accent: "var(--app-accent)",
  muted: "var(--app-muted)",
  positive: "var(--app-positive)",
};

/** Design token for a tone. Never a raw hex — light and dark both resolve. */
export function toneColor(tone: UrgencyTone): string {
  return TONE_VARS[tone];
}

export function ownerLabel(role: RoadmapOwnerRole): string {
  return OWNER_ROLE_LABELS[role];
}

/**
 * "Starts in 12 days", "Ends today", "Window closed 4 days ago" — always phrased as
 * arithmetic on the team's kickoff date, never as a FIRST deadline.
 */
export function countdownLabel(
  dates: { start: string; end: string } | null,
  today: string,
): string | null {
  if (!dates) return null;
  const toStart = daysBetween(today, dates.start);
  const toEnd = daysBetween(today, dates.end);
  if (toStart == null || toEnd == null) return null;
  if (toEnd < 0) {
    const ago = Math.abs(toEnd);
    return `Window closed ${ago} ${ago === 1 ? "day" : "days"} ago`;
  }
  if (toStart > 0) return `Starts in ${toStart} ${toStart === 1 ? "day" : "days"}`;
  if (toEnd === 0) return "Last day of this window";
  return `${toEnd} ${toEnd === 1 ? "day" : "days"} left in this window`;
}

/** "12 Jan 2026 – 18 Jan 2026", or null when the team has set no kickoff date. */
export function formatDateRange(dates: { start: string; end: string } | null): string | null {
  if (!dates) return null;
  const start = formatIsoDate(dates.start);
  const end = formatIsoDate(dates.end);
  if (!start || !end) return null;
  return start === end ? start : `${start} – ${end}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** UTC-stable date formatting — a date-only value must not shift by timezone. */
export function formatIsoDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}`;
}

/**
 * The one-line answer to "how are we doing". Honest when nothing is set up yet —
 * a fresh team gets an invitation, not a fake 0% score.
 */
export function summaryLine(summary: {
  total: number;
  done: number;
  skipped: number;
  overdue: number;
  dueNow: number;
  percentComplete: number;
}, hasKickoff: boolean): string {
  if (summary.total === 0) return "No tasks to show.";
  if (summary.done === 0 && summary.skipped === 0) {
    return hasKickoff
      ? `${summary.total} tasks on the roadmap. Nothing ticked off yet.`
      : `${summary.total} tasks on the roadmap. Set your kickoff date to see when each one is due.`;
  }
  const parts = [`${summary.done} of ${summary.total} done`];
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.overdue > 0) parts.push(`${summary.overdue} past their window`);
  else if (summary.dueNow > 0) parts.push(`${summary.dueNow} due now`);
  return `${parts.join(" · ")}.`;
}
