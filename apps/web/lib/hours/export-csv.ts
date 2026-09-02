// Per-member build-hours CSV — pure and unit-tested. The API route reads the
// rows; this file only shapes them. Nothing here invents time: an open session
// exports with an empty clock_out and no minutes, and an auto-closed session is
// flagged so a mentor reviewing the sheet knows the departure time was capped.

import type { CsvValue } from "@vantage/export-center";
import { csvHeader, csvRow } from "@vantage/export-center";

export const HOURS_EXPORT_COLUMNS = [
  "date",
  "clock_in",
  "clock_out",
  "minutes",
  "kind",
  "auto_closed",
  "auto_closed_reason",
  "note",
  "linked_event",
  "occurrence_date",
] as const;

export type HoursExportLog = {
  id: string;
  kind: string;
  clockIn: string;
  clockOut: string | null;
  note: string;
  autoClosed: boolean;
  autoClosedReason: string | null;
  /** Title of the linked calendar occurrence, when the session was attached to one. */
  linkedEventTitle: string | null;
  occurrenceDate: string | null;
};

export type HoursExportRange = { from: string | null; to: string | null };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates `from`/`to` (YYYY-MM-DD, inclusive). Returns null when either is
 * malformed or the range is inverted, so the route can 400 instead of guessing.
 */
export function parseHoursExportRange(from: unknown, to: unknown): HoursExportRange | null {
  const clean = (value: unknown): string | null | false => {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !DATE_ONLY.test(value)) return false;
    return Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : false;
  };
  const start = clean(from);
  const end = clean(to);
  if (start === false || end === false) return null;
  if (start && end && start > end) return null;
  return { from: start, to: end };
}

export function sessionMinutes(log: Pick<HoursExportLog, "clockIn" | "clockOut">): number | null {
  if (!log.clockOut) return null;
  const start = Date.parse(log.clockIn);
  const end = Date.parse(log.clockOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 60_000);
}

export function hoursExportRows(logs: HoursExportLog[]): Array<Record<(typeof HOURS_EXPORT_COLUMNS)[number], CsvValue>> {
  return [...logs]
    .sort((a, b) => a.clockIn.localeCompare(b.clockIn) || a.id.localeCompare(b.id))
    .map((log) => ({
      date: log.clockIn.slice(0, 10),
      clock_in: log.clockIn,
      clock_out: log.clockOut ?? "",
      minutes: sessionMinutes(log) ?? "",
      kind: log.kind,
      auto_closed: log.autoClosed ? "yes" : "no",
      auto_closed_reason: log.autoClosed ? (log.autoClosedReason ?? "") : "",
      note: log.note ?? "",
      linked_event: log.linkedEventTitle ?? "",
      occurrence_date: log.occurrenceDate ?? "",
    }));
}

export function buildHoursCsv(logs: HoursExportLog[]): string {
  const columns = [...HOURS_EXPORT_COLUMNS];
  let csv = csvHeader(columns);
  for (const row of hoursExportRows(logs)) csv += csvRow(columns, row);
  return csv;
}

/** `hours_<member>_<from>_<to>.csv`, safe for a Content-Disposition header. */
export function hoursExportFileName(input: { memberName: string | null; range: HoursExportRange }): string {
  const member = (input.memberName ?? "member")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "member";
  const span = [input.range.from ?? "start", input.range.to ?? "now"].join("_");
  return `hours_${member}_${span}.csv`;
}
