/**
 * Per-match report shape: raw answers, free-text notes, derived rates, timeline.
 * Only real payload keys are shown. Missing sections stay empty.
 */

import {
  formatLookupValue,
  lookupMetricLabel,
  scoutMetricsFromPayload,
  type LovatLookupMetricId,
} from "../intel/lovat-lookup";

export type ScoutReportStat = {
  key: string;
  label: string;
  value: string;
};

export type ScoutReportEvent = {
  atSeconds: number | null;
  label: string;
};

export type ScoutReportRate = {
  id: LovatLookupMetricId;
  label: string;
  value: string;
};

export type ScoutReportView = {
  stats: ScoutReportStat[];
  notes: string[];
  rates: ScoutReportRate[];
  timeline: ScoutReportEvent[];
};

const TIMELINE_KEYS = new Set(["timeline", "actions", "events", "actionLog"]);
const NOTE_KEYS = new Set(["notes", "note", "comments", "comment", "observation", "observations", "summary", "pitNotes"]);

function humanLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function formatStatValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(formatStatValue).filter((part): part is string => part != null);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([innerKey, inner]) => {
        const formatted = formatStatValue(inner);
        return formatted == null ? null : `${humanLabel(innerKey)} ${formatted}`;
      })
      .filter((part): part is string => part != null);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function isNoteKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (NOTE_KEYS.has(key)) return true;
  return (
    norm === "notes" ||
    norm === "note" ||
    norm === "comments" ||
    norm === "comment" ||
    norm === "observation" ||
    norm === "observations" ||
    norm === "summary" ||
    norm === "pitnotes" ||
    norm.endsWith("notes") ||
    norm.endsWith("comments") ||
    norm.endsWith("comment")
  );
}

export function notesFromPayload(payload: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(payload)) {
    if (!isNoteKey(key) || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length < 1 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    notes.push(trimmed);
  }
  return notes;
}

export function ratesFromPayload(payload: Record<string, unknown>): ScoutReportRate[] {
  const metrics = scoutMetricsFromPayload(payload);
  const rates: ScoutReportRate[] = [];
  for (const [id, value] of Object.entries(metrics) as Array<[LovatLookupMetricId, number | null | undefined]>) {
    if (value == null || !Number.isFinite(value)) continue;
    rates.push({
      id,
      label: lookupMetricLabel(id),
      value: formatLookupValue(value, id === "estimatedSuccessfulFuelRate" ? 2 : 1),
    });
  }
  return rates;
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

export function statsFromPayload(payload: Record<string, unknown>): ScoutReportStat[] {
  const stats: ScoutReportStat[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (TIMELINE_KEYS.has(key) || isNoteKey(key)) continue;
    const formatted = formatStatValue(value);
    if (formatted == null) continue;
    stats.push({ key, label: humanLabel(key), value: formatted });
  }
  return stats.sort((a, b) => a.label.localeCompare(b.label));
}

export function scoutReportFromPayload(payload: Record<string, unknown> | null | undefined): ScoutReportView {
  if (!payload || typeof payload !== "object") {
    return { stats: [], notes: [], rates: [], timeline: [] };
  }
  return {
    stats: statsFromPayload(payload),
    notes: notesFromPayload(payload),
    rates: ratesFromPayload(payload),
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
