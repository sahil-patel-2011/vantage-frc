/**
 * Build-hours CSV export.
 *
 * Teams need this for two real-world reasons: proving community-service hours to a school, and
 * handing a mentor a spreadsheet at the end of a season. Both are official records, so the export
 * is deliberately literal — it reports what is stored, marks sessions the sweep closed, and never
 * invents a clock-out for a session that is still open.
 *
 * Privacy: a member exports their own hours, a mentor exports the team's. That decision is made
 * here, in `visibleLogs`, rather than at the call site, so it cannot drift between entry points.
 */

import type { HourLog } from "../build-hours";
import { recordHours } from "../build-hours";

export type ExportableHourLog = HourLog & {
  autoClosed?: boolean | null;
  autoClosedReason?: string | null;
};

export type HoursExportScope = "self" | "team";

export function exportScopeFor(role: string | null | undefined): HoursExportScope {
  return role === "owner" || role === "admin" ? "team" : "self";
}

/**
 * The rows this caller may see. A member's export is their own history only; nothing about a
 * teammate's schedule leaks through a CSV that a member can download and share.
 */
export function visibleLogs(
  logs: readonly ExportableHourLog[],
  input: { role: string | null | undefined; userId: string },
): ExportableHourLog[] {
  if (exportScopeFor(input.role) === "team") return [...logs];
  return logs.filter((log) => log.userId === input.userId);
}

/**
 * RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would execute. A note of
 * `=cmd|...` is a formula-injection payload in Excel, and hour notes are free text typed by
 * students.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export const HOURS_EXPORT_COLUMNS = [
  "Member",
  "Kind",
  "Clock in",
  "Clock out",
  "Hours",
  "Status",
  "Closed by",
  "Auto-closed reason",
  "Note",
] as const;

function statusOf(log: ExportableHourLog): string {
  if (!log.clockOut) return "open";
  if (log.autoClosed) return "auto-closed";
  return "closed";
}

export type HoursExportOptions = {
  /** Only sessions that started on or after this ISO date, if given. */
  from?: string | null;
  /** Only sessions that started before or on this ISO date, if given. */
  to?: string | null;
};

function withinRange(log: ExportableHourLog, options: HoursExportOptions): boolean {
  const started = Date.parse(log.clockIn);
  if (!Number.isFinite(started)) return false;
  if (options.from) {
    const from = Date.parse(`${options.from}T00:00:00.000Z`);
    if (Number.isFinite(from) && started < from) return false;
  }
  if (options.to) {
    const to = Date.parse(`${options.to}T23:59:59.999Z`);
    if (Number.isFinite(to) && started > to) return false;
  }
  return true;
}

/**
 * The CSV body. Open sessions are exported with an empty clock-out and an empty hours cell rather
 * than an elapsed-so-far number: an unfinished session has no defensible hour count, and a school
 * reading this file should see the gap instead of a number nobody verified.
 */
export function hoursCsv(
  logs: readonly ExportableHourLog[],
  options: HoursExportOptions = {},
): string {
  const rows = logs
    .filter((log) => withinRange(log, options))
    .slice()
    .sort((a, b) => a.clockIn.localeCompare(b.clockIn));

  const lines = [HOURS_EXPORT_COLUMNS.join(",")];
  for (const log of rows) {
    lines.push(
      [
        csvCell(log.userName ?? "Unknown member"),
        csvCell(log.kind),
        csvCell(log.clockIn),
        csvCell(log.clockOut ?? ""),
        csvCell(log.clockOut ? recordHours(log).toFixed(2) : ""),
        csvCell(statusOf(log)),
        csvCell(log.closedByName ?? ""),
        csvCell(log.autoClosedReason ?? ""),
        csvCell(log.note ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function hoursExportFileName(input: {
  teamNumber: number | null;
  scope: HoursExportScope;
  today: string;
}): string {
  const team = input.teamNumber ? `team-${input.teamNumber}` : "team";
  return `${team}-hours-${input.scope}-${input.today}.csv`;
}
