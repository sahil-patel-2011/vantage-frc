import {
  recordHours,
  type BuildHoursView,
  type HourKind,
  type HourLog,
} from "../../lib/build-hours";

export type ReadyView = Extract<BuildHoursView, { status: "ready" }>;
export type ActionBody = Record<string, unknown> & { action: string; orgId: string };
export type HoursRun = (body: ActionBody, key: string) => Promise<boolean | void>;

export function fmtHours(value: number): string {
  return `${value % 1 === 0 ? value : value.toFixed(2)}h`;
}

/**
 * "Oct 10, 2:00 PM". The year is added when it is not this year: "Jan 5, 10:00 AM" for an entry
 * dated 2027 looked like this January.
 */
export function fmtClock(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const otherYear = date.getFullYear() !== new Date(now).getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(otherYear ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One entry's length: "45 min" under an hour, "under 1 min" for a tap-in-tap-out, else hours. */
export function fmtDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0 min";
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return minutes < 1 ? "under 1 min" : `${minutes} min`;
  }
  return fmtHours(Math.round(hours * 100) / 100);
}

/** Local value for a datetime-local input ("2026-10-11T18:30") from an ISO instant. */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function elapsedLabel(clockIn: string, now: number): string {
  const ms = now - new Date(clockIn).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function hoursRecordLineHours(record: HourLog, now: number): string {
  if (!record.clockOut) return fmtHours(recordHours(record, now));
  const start = new Date(record.clockIn).getTime();
  const end = new Date(record.clockOut).getTime();
  return fmtDuration(Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 3_600_000 : 0);
}

export type { HourKind, HourLog, BuildHoursView };
