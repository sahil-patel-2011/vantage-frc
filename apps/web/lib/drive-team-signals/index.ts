// Pure helper functions for the drive-team signal board — no I/O, unit-testable.

import type {
  DriveTeamSignal,
  DriveTeamSignalSheet,
  DriveTeamSignalsSummary,
  SignalKind,
  SignalPriority,
  SignalRole,
} from "./types";

export const SIGNAL_KINDS: SignalKind[] = [
  "hand_signal",
  "verbal_callout",
  "radio_code",
  "field_marker",
  "other",
];

export const SIGNAL_PRIORITIES: SignalPriority[] = ["critical", "important", "fyi"];

export const SIGNAL_ROLES: SignalRole[] = ["driver", "human_player", "coach", "scout", "other"];

const KIND_LABELS: Record<SignalKind, string> = {
  hand_signal: "Hand signal",
  verbal_callout: "Verbal callout",
  radio_code: "Radio code",
  field_marker: "Field marker",
  other: "Other",
};

const ROLE_LABELS: Record<SignalRole, string> = {
  driver: "Driver",
  human_player: "Human player",
  coach: "Coach",
  scout: "Scout",
  other: "Other",
};

export function signalKindLabel(kind: SignalKind): string {
  return KIND_LABELS[kind] ?? kind;
}

export function signalRoleLabel(role: SignalRole): string {
  return ROLE_LABELS[role] ?? role;
}

/** Sanitize a raw jsonb array into a well-formed signal list, dropping malformed entries. */
export function sanitizeSignals(raw: unknown): DriveTeamSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: DriveTeamSignal[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id ? record.id : null;
    const code = typeof record.code === "string" ? record.code.trim() : "";
    const meaning = typeof record.meaning === "string" ? record.meaning.trim() : "";
    if (!id || !code || !meaning) continue;
    const kind = (SIGNAL_KINDS as string[]).includes(record.kind as string)
      ? (record.kind as SignalKind)
      : "other";
    const priority = (SIGNAL_PRIORITIES as string[]).includes(record.priority as string)
      ? (record.priority as SignalPriority)
      : "important";
    const calledBy = (SIGNAL_ROLES as string[]).includes(record.calledBy as string)
      ? (record.calledBy as SignalRole)
      : "driver";
    out.push({ id, kind, code: code.slice(0, 80), meaning: meaning.slice(0, 400), calledBy, priority });
  }
  return out;
}

export function summarizeSheets(sheets: DriveTeamSignalSheet[]): DriveTeamSignalsSummary {
  const kindMap = new Map<SignalKind, number>();
  const priorityMap = new Map<SignalPriority, number>();
  let totalSignals = 0;
  let criticalSignals = 0;

  for (const sheet of sheets) {
    for (const signal of sheet.signals) {
      totalSignals += 1;
      kindMap.set(signal.kind, (kindMap.get(signal.kind) ?? 0) + 1);
      priorityMap.set(signal.priority, (priorityMap.get(signal.priority) ?? 0) + 1);
      if (signal.priority === "critical") criticalSignals += 1;
    }
  }

  const byKind = SIGNAL_KINDS.filter((kind) => kindMap.has(kind)).map((kind) => ({
    kind,
    count: kindMap.get(kind) ?? 0,
  }));
  const byPriority = SIGNAL_PRIORITIES.filter((priority) => priorityMap.has(priority)).map((priority) => ({
    priority,
    count: priorityMap.get(priority) ?? 0,
  }));

  return {
    totalSheets: sheets.length,
    totalSignals,
    criticalSignals,
    byKind,
    byPriority,
  };
}

export * from "./types";
