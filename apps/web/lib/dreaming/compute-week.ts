/**
 * Weekly roll-up of the nightly dreams.
 *
 * The week summary is built ONLY from the daily dream rows the team already
 * has — it never re-reads raw activity tables. That keeps the honest pipeline
 * intact: if a day wrote no memory (idle, or an error), it simply is not part
 * of the week, and a week with fewer than WEEK_MIN_DAYS daily rows produces
 * nothing at all rather than a summary of thin air.
 *
 * Pure: no DB, no fetch, no clock reads.
 */

import { clampExcerpt } from "./compute-dream";

/** Fewer daily rows than this in the window → skip the week entirely. */
export const WEEK_MIN_DAYS = 3;

/** Per-day text budget inside the week prompt (daily rows cap at 3200). */
export const WEEK_DAY_EXCERPT_CHARS = 900;

export type WeekDayEntry = {
  /** YYYY-MM-DD (UTC). */
  day: string;
  /** The stored daily dream memory content, verbatim from team_memories. */
  content: string;
};

export type WeekDigest = {
  orgName: string;
  /** YYYY-MM-DD (UTC), inclusive. */
  weekStart: string;
  /** YYYY-MM-DD (UTC), inclusive — the Saturday the roll-up is filed under. */
  weekEnd: string;
  /** Daily dream rows that actually stored content, oldest first. */
  days: WeekDayEntry[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayToUtcMs(day: string): number {
  if (!ISO_DAY.test(day)) throw new Error(`Invalid day: ${day}`);
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year!, month! - 1, date!);
}

function utcMsToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD day by whole UTC days. Pure — no local timezone. */
export function shiftDay(day: string, deltaDays: number): string {
  return utcMsToDay(dayToUtcMs(day) + deltaDays * DAY_MS);
}

/** UTC day-of-week, 0 = Sunday … 6 = Saturday. */
export function utcWeekday(day: string): number {
  return new Date(dayToUtcMs(day)).getUTCDay();
}

/**
 * The weekly roll-up rides along with Saturday's nightly run. Nightly runs are
 * filed under the UTC day they execute, so this is a plain UTC-Saturday test.
 */
export function isWeeklyRollupDay(day: string): boolean {
  return utcWeekday(day) === 6;
}

/** The seven-day window ending on (and including) `day`. */
export function weekWindow(day: string): { start: string; end: string } {
  return { start: shiftDay(day, -6), end: day };
}

/** True when there is enough real material to summarise the week. */
export function hasWeekMaterial(digest: WeekDigest): boolean {
  return digest.days.length >= WEEK_MIN_DAYS;
}

/**
 * The week's daily recaps rendered as dated blocks. Shared by the model prompt
 * and the deterministic fallback so both summarise the exact same text.
 */
export function renderWeekFacts(digest: WeekDigest): string {
  return digest.days
    .map((entry) => `[${entry.day}]\n${clampExcerpt(entry.content, WEEK_DAY_EXCERPT_CHARS)}`)
    .join("\n\n");
}

export function assembleWeekPrompt(digest: WeekDigest): string {
  return [
    `You are consolidating one week of daily recaps for the FRC team "${digest.orgName}" into a single week summary.`,
    `The week runs ${digest.weekStart} through ${digest.weekEnd}. ` +
      `${digest.days.length} of those days recorded activity; the rest were idle.`,
    "Write a compact week summary with exactly these three short sections:",
    "1. The week in review",
    "2. What is still open",
    "3. What next week should start with",
    "",
    "Grounding rules (mandatory):",
    "Use ONLY the daily recaps quoted below.",
    "- Do not fill gaps between days: a day not quoted below recorded nothing.",
    '- If a section has no supporting facts, write exactly "Nothing recorded."',
    "- Plain text only, no markdown headings, under 250 words total.",
    "",
    `Daily recaps for ${digest.weekStart} — ${digest.weekEnd}:`,
    renderWeekFacts(digest),
  ].join("\n");
}

/**
 * No-AI fallback: the week's daily recaps stitched together verbatim, with a
 * header that says plainly that no model wrote it.
 */
export function deterministicWeek(digest: WeekDigest): string {
  return [
    `Week in review ${digest.weekStart} — ${digest.weekEnd} — ${digest.orgName} ` +
      `(auto-generated from ${digest.days.length} daily recaps; no AI summary available).`,
    "",
    renderWeekFacts(digest),
  ].join("\n");
}
