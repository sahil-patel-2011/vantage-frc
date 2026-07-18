// Pure helper functions for the pre-match checklist — no I/O, unit-testable.

import type { ChecklistItem, ChecklistItemKey, MatchChecklistRun, MatchChecklistSummary } from "./types";

export const CHECKLIST_ITEM_KEYS: ChecklistItemKey[] = ["bumper", "battery", "tether", "code"];

const ITEM_LABELS: Record<ChecklistItemKey, string> = {
  bumper: "Bumpers secured",
  battery: "Battery charged & seated",
  tether: "Tether / e-stop clipped",
  code: "Code deployed & radio linked",
};

export function checklistItemLabel(key: ChecklistItemKey): string {
  return ITEM_LABELS[key] ?? key;
}

/** Fresh default item set for a newly-started checklist run. */
export function buildDefaultItems(): ChecklistItem[] {
  return CHECKLIST_ITEM_KEYS.map((key) => ({
    key,
    label: checklistItemLabel(key),
    done: false,
    checkedAt: null,
  }));
}

export function isRunComplete(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((item) => item.done);
}

/** Seconds between startedAt and (completedAt ?? now). Null if startedAt is missing/invalid. */
export function computeElapsedSeconds(
  startedAt: string | null,
  completedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const end = completedAt ? new Date(completedAt).getTime() : now.getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function summarizeRuns(runs: MatchChecklistRun[]): MatchChecklistSummary {
  const totalRuns = runs.length;
  const completed = runs.filter((run) => run.completedAt != null);
  const completedRuns = completed.length;
  const openRuns = totalRuns - completedRuns;

  const completedElapsed = completed
    .map((run) => run.elapsedSeconds)
    .filter((value): value is number => value != null);

  const averageElapsedSeconds =
    completedElapsed.length > 0
      ? Math.round(completedElapsed.reduce((sum, value) => sum + value, 0) / completedElapsed.length)
      : null;
  const fastestElapsedSeconds = completedElapsed.length > 0 ? Math.min(...completedElapsed) : null;

  return {
    totalRuns,
    completedRuns,
    openRuns,
    averageElapsedSeconds,
    fastestElapsedSeconds,
  };
}

export function formatElapsed(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
