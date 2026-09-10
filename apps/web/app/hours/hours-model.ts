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

export function fmtClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
  return fmtHours(recordHours(record, now));
}

export type { HourKind, HourLog, BuildHoursView };
