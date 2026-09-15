/**
 * Match report viewer: stats grouped like the stand job (auto / teleop / endgame / notes)
 * plus an action timeline. Only real payload keys are shown. Missing timeline / empty
 * payload stay empty — never invent numbers.
 */

import {
  classifyMatchJobPhase,
  isMatchJobNotesField,
  MATCH_JOB_PHASE_COPY,
  MATCH_JOB_PHASE_ORDER,
  type MatchJobPhase,
} from "./match-job-layout";

export type ScoutReportStat = {
  key: string;
  label: string;
  value: string;
};

export type ScoutReportEvent = {
  atSeconds: number | null;
  label: string;
};

export type ScoutReportGroup = {
  phase: MatchJobPhase;
  title: string;
  stats: ScoutReportStat[];
};

export type ScoutReportView = {
  stats: ScoutReportStat[];
  timeline: ScoutReportEvent[];
  notes: string | null;
  groups: ScoutReportGroup[];
};

const TIMELINE_KEYS = new Set(["timeline", "actions", "events", "actionLog"]);

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

export function notesFromPayload(payload: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!isMatchJobNotesField(key)) continue;
    const formatted = formatStatValue(value);
    if (formatted) parts.push(formatted);
  }
  return parts.length ? parts.join("\n") : null;
}

export function statsFromPayload(payload: Record<string, unknown>): ScoutReportStat[] {
  const stats: ScoutReportStat[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (TIMELINE_KEYS.has(key)) continue;
    if (isMatchJobNotesField(key)) continue;
    const formatted = formatStatValue(value);
    if (formatted == null) continue;
    stats.push({ key, label: humanLabel(key), value: formatted });
  }
  return stats.sort((a, b) => a.label.localeCompare(b.label));
}

export function groupsFromStats(stats: ScoutReportStat[]): ScoutReportGroup[] {
  const buckets: Record<MatchJobPhase, ScoutReportStat[]> = {
    auto: [],
    teleop: [],
    endgame: [],
    other: [],
    notes: [],
  };
  for (const stat of stats) {
    const phase = classifyMatchJobPhase({ key: stat.key, label: stat.label, type: "text" }) ?? "other";
    buckets[phase].push(stat);
  }
  const groups: ScoutReportGroup[] = [];
  for (const phase of MATCH_JOB_PHASE_ORDER) {
    if (phase === "notes") continue;
    const grouped = buckets[phase];
    if (!grouped.length) continue;
    groups.push({
      phase,
      title: MATCH_JOB_PHASE_COPY[phase].title,
      stats: grouped,
    });
  }
  return groups;
}

const EMPTY_REPORT: ScoutReportView = { stats: [], timeline: [], notes: null, groups: [] };

export function scoutReportFromPayload(payload: Record<string, unknown> | null | undefined): ScoutReportView {
  if (!payload || typeof payload !== "object") return EMPTY_REPORT;
  const stats = statsFromPayload(payload);
  return {
    stats,
    timeline: timelineFromPayload(payload),
    notes: notesFromPayload(payload),
    groups: groupsFromStats(stats),
  };
}

export function formatReportClock(atSeconds: number | null): string {
  if (atSeconds == null || !Number.isFinite(atSeconds)) return "—";
  const total = Math.max(0, Math.round(atSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
