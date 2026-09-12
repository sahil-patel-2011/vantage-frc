import { hubHref } from "../nav/hubs";
import type { CompetitionRelatedId } from "../strategy/competition-related";
import type { MatchChecklistRun, MatchChecklistSummary } from "./types";

/** Focused Soft-UI Competition strip when Match checklist is open (never DEMO placeholders). */
export const MATCH_CHECKLIST_RELATED_INCLUDE: CompetitionRelatedId[] = [
  "command",
  "my-day",
  "scouting",
  "strategy",
];

export type MatchChecklistNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Readable Soft-UI next actions for pre-match checklists.
 * Points at real Event day / My Day / Scouting / Strategy paths — never DEMO progress.
 */
export function matchChecklistNextActions(input: {
  orgId?: string | null;
  runs?: MatchChecklistRun[];
  upcomingMatches?: Array<{ label: string; bumperColor: "red" | "blue" }>;
}): MatchChecklistNextAction[] {
  const orgId = input.orgId ?? null;
  const runs = input.runs ?? [];

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before starting timed checklists.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: MatchChecklistNextAction[] = [];
  const open = runs.filter((run) => !run.allDone);
  const upcoming = input.upcomingMatches ?? [];
  const nextHang = upcoming.find(
    (match) => !runs.some((run) => run.matchLabel === match.label && !run.allDone),
  );

  if (runs.length === 0 && nextHang) {
    actions.push({
      id: "hang-bumpers",
      label: `Hang ${nextHang.bumperColor.toUpperCase()} bumpers for ${nextHang.label}`,
      detail: "Hang the color for this match from the alliance list — start the checklist once that set is on.",
      href: hubHref("/competition", "match-checklist", orgId),
      primary: true,
    });
  } else if (runs.length === 0) {
    actions.push({
      id: "start-run",
      label: "Start your first checklist",
      detail: "Enter a match label below — progress appears only after you check real pit items.",
      href: hubHref("/competition", "match-checklist", orgId),
      primary: true,
    });
  } else if (open.length > 0) {
    const sample = open[0]!;
    actions.push({
      id: "finish-open",
      label: `Finish ${sample.matchLabel}`,
      detail: `${countDoneItems(sample.items)} of ${sample.items.length} items checked — tap the remaining items to mark ready.`,
      href: hubHref("/competition", "match-checklist", orgId),
      primary: true,
    });
  } else {
    actions.push({
      id: "next-match",
      label: "Start the next match checklist",
      detail: "Prior runs stay in history with real elapsed times.",
      href: hubHref("/competition", "match-checklist", orgId),
      primary: true,
    });
  }

  actions.push(
    {
      id: "command",
      label: "Open Event day",
      detail: "Match schedule and pit queues share the same event context.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "my-day",
      label: "Open My Day",
      detail: "See your personal assignments beside pre-match prep.",
      href: hubHref("/competition", "my-day", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Log match notes once the robot is on the field.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick lists stay grounded in scouted data — empty until real metrics exist.",
      href: hubHref("/competition", "strategy", orgId),
    },
  );

  return actions;
}

/** Count checked items only — never invents DEMO partial progress. */
export function countDoneItems(items: { done: boolean }[]): number {
  return items.filter((item) => item.done).length;
}

/** Human progress label from real item states. */
export function formatItemProgress(items: { done: boolean }[]): string {
  if (items.length === 0) return "No items";
  const done = countDoneItems(items);
  if (done === items.length) return "All clear";
  return `${done} of ${items.length} checked`;
}

/** True only when at least one completed run has a real elapsed time. */
export function summaryHasTimingEvidence(summary: MatchChecklistSummary): boolean {
  return (
    summary.completedRuns > 0 &&
    summary.averageElapsedSeconds != null &&
    summary.fastestElapsedSeconds != null
  );
}

/** Hide zeroed summary tiles when there are no runs — avoids looking like DEMO counters. */
export function shouldShowSummaryTiles(summary: MatchChecklistSummary): boolean {
  return summary.totalRuns > 0;
}
