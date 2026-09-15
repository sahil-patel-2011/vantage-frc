/**
 * Lovat Match Data Viewer shape: a scout report as stats + an action timeline.
 * Only real payload keys are shown. Missing timeline / empty payload stay empty.
 */

import { isLayoutOnlyField, type SchemaDefinition } from "@vantage/scouting";

export type ScoutReportStat = {
  key: string;
  label: string;
  value: string;
};

export type ScoutReportEvent = {
  atSeconds: number | null;
  label: string;
};

export type ScoutReportView = {
  stats: ScoutReportStat[];
  timeline: ScoutReportEvent[];
};

const TIMELINE_KEYS = new Set(["timeline", "actions", "events", "actionLog"]);

function humanLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function formatStatValue(key: string, value: unknown): string | null {
  if (value == null) return null;
  if (key === "robot_images") {
    const count = Array.isArray(value)
      ? value.filter((item) => typeof item === "string" && item.length > 0).length
      : typeof value === "string" && value.trim()
        ? 1
        : 0;
    return count > 0 ? `${count} photo${count === 1 ? "" : "s"}` : null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed.replaceAll("_", " ") : null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatStatValue(key, item))
      .filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function readSeconds(row: Record<string, unknown>): number | null {
  for (const key of ["atSeconds", "tSeconds", "seconds", "t", "at", "time"]) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function readEventLabel(row: Record<string, unknown>): string | null {
  for (const key of ["label", "action", "name", "event", "type"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function timelineFromPayload(payload: Record<string, unknown>): ScoutReportEvent[] {
  const events: ScoutReportEvent[] = [];
  for (const key of TIMELINE_KEYS) {
    const raw = payload[key];
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const label = readEventLabel(row);
      if (!label) continue;
      events.push({ atSeconds: readSeconds(row), label });
    }
  }
  return events.sort((a, b) => {
    if (a.atSeconds == null && b.atSeconds == null) return a.label.localeCompare(b.label);
    if (a.atSeconds == null) return 1;
    if (b.atSeconds == null) return -1;
    return a.atSeconds - b.atSeconds;
  });
}

export function statsFromPayload(
  payload: Record<string, unknown>,
  schema?: SchemaDefinition | null,
): ScoutReportStat[] {
  const stats: ScoutReportStat[] = [];
  const seen = new Set<string>();
  const fields = schema?.fields ?? [];
  for (const field of fields) {
    if (isLayoutOnlyField(field) || TIMELINE_KEYS.has(field.key)) continue;
    const formatted = formatStatValue(field.key, payload[field.key]);
    if (formatted == null) continue;
    seen.add(field.key);
    stats.push({ key: field.key, label: field.label, value: formatted });
  }
  for (const [key, value] of Object.entries(payload)) {
    if (seen.has(key) || TIMELINE_KEYS.has(key)) continue;
    const formatted = formatStatValue(key, value);
    if (formatted == null) continue;
    stats.push({ key, label: humanLabel(key), value: formatted });
  }
  return stats.sort((a, b) => a.label.localeCompare(b.label));
}

export function scoutReportFromPayload(
  payload: Record<string, unknown> | null | undefined,
  schema?: SchemaDefinition | null,
): ScoutReportView {
  if (!payload || typeof payload !== "object") return { stats: [], timeline: [] };
  return {
    stats: statsFromPayload(payload, schema),
    timeline: timelineFromPayload(payload),
  };
}

export function formatReportClock(atSeconds: number | null): string {
  if (atSeconds == null || !Number.isFinite(atSeconds)) return "—";
  const total = Math.max(0, Math.round(atSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
