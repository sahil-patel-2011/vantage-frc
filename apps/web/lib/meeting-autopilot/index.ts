// Pure, framework-free agenda-building and minutes-parsing logic. Everything here is
// deterministic and grounded only in the rows/text the caller supplies — it never fabricates a
// value. compute-meeting-autopilot.ts wraps this with DB I/O; the API route and client render
// results.

import type { AgendaItem, AgendaSourceCounts, AgendaSourceInput, ParsedActionItem } from "./types";

export const AGENDA_ITEM_KINDS = ["blocker", "overdue_task", "decision", "fmea"] as const;

const PRIORITY_WEIGHT: Record<string, number> = { critical: 30, high: 20, normal: 10, low: 5 };

function priorityWeight(priority: string): number {
  return PRIORITY_WEIGHT[priority] ?? PRIORITY_WEIGHT.normal!;
}

export function agendaItemKindLabel(kind: AgendaItem["kind"]): string {
  switch (kind) {
    case "blocker":
      return "Open blocker";
    case "overdue_task":
      return "Overdue task";
    case "decision":
      return "Unresolved decision";
    case "fmea":
      return "Open FMEA";
    default:
      return kind;
  }
}

function daysOverdue(dueOn: string, now: Date): number {
  const due = new Date(`${dueOn}T00:00:00Z`);
  const diffMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - due.getTime();
  return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
}

/** Failure Mode risk priority number: occurrence x severity x detection (standard FMEA formula). */
export function computeRpn(occurrence: number, severity: number, detection: number): number {
  return Math.max(0, Math.round(occurrence)) * Math.max(0, Math.round(severity)) * Math.max(0, Math.round(detection));
}

/** Builds a ranked agenda from open blockers, overdue tasks, unresolved decisions, and open FMEA. */
export function buildAgendaItems(input: AgendaSourceInput, now: Date = new Date()): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const blocker of input.blockers) {
    items.push({
      kind: "blocker",
      sourceId: blocker.id,
      title: blocker.title,
      detail: `${blocker.subsystem} — ${blocker.blockedReason?.trim() || "blocked, no reason logged"}`,
      weight: 1_000 + priorityWeight(blocker.priority),
    });
  }

  for (const task of input.overdueTasks) {
    const overdue = daysOverdue(task.dueOn, now);
    items.push({
      kind: "overdue_task",
      sourceId: task.id,
      title: task.title,
      detail: `${task.subsystem} — due ${task.dueOn} (${overdue} day${overdue === 1 ? "" : "s"} overdue)`,
      weight: 500 + priorityWeight(task.priority) + Math.min(100, overdue),
    });
  }

  for (const decision of input.decisions) {
    items.push({
      kind: "decision",
      sourceId: decision.id,
      title: decision.title,
      detail: `${decision.category} decision proposed ${decision.createdAt.slice(0, 10)} — still awaiting a call`,
      weight: 200,
    });
  }

  for (const failure of input.fmeaFailures) {
    const rpn = computeRpn(failure.occurrence, failure.severity, failure.detection);
    items.push({
      kind: "fmea",
      sourceId: failure.id,
      title: failure.title,
      detail: `${failure.subsystemName} — RPN ${rpn} (occurrence ${failure.occurrence}, severity ${failure.severity}, detection ${failure.detection})`,
      weight: 100 + Math.min(200, rpn),
    });
  }

  return items.sort((a, b) => b.weight - a.weight);
}

export function summarizeAgendaSources(input: AgendaSourceInput): AgendaSourceCounts {
  return {
    blockers: input.blockers.length,
    overdueTasks: input.overdueTasks.length,
    decisions: input.decisions.length,
    fmea: input.fmeaFailures.length,
  };
}

const OWNER_MENTION_RE = /@([A-Za-z][\w.'-]*)/;
const DUE_DATE_RE = /\b(?:due|by)\s+(\d{4}-\d{2}-\d{2})\b/i;
const BULLET_RE = /^(?:[-*•]\s*|(?:todo|action)\s*[:-]\s*)(.+)$/i;

/**
 * Deterministically extracts action items from raw post-meeting minutes text. Only bulleted /
 * "TODO:" / "Action:" lines are treated as action items; everything else in the minutes is
 * discarded rather than guessed at. Optional `@Owner` mentions and `due YYYY-MM-DD` / `by
 * YYYY-MM-DD` markers are lifted out of the line text into structured fields.
 */
export function parseActionItemsFromMinutes(minutesText: string): ParsedActionItem[] {
  const lines = minutesText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: ParsedActionItem[] = [];
  for (const line of lines) {
    const bulletMatch = BULLET_RE.exec(line);
    if (!bulletMatch) continue;
    let text = bulletMatch[1]!.trim();
    if (!text) continue;

    let owner: string | null = null;
    const ownerMatch = OWNER_MENTION_RE.exec(text);
    if (ownerMatch) {
      owner = ownerMatch[1]!.trim();
      text = text.replace(ownerMatch[0], "").trim();
    }

    let dueOn: string | null = null;
    const dueMatch = DUE_DATE_RE.exec(text);
    if (dueMatch) {
      dueOn = dueMatch[1]!;
      text = text.replace(dueMatch[0], "").trim();
    }

    text = text.replace(/\s{2,}/g, " ").replace(/[\s,:;-]+$/, "").trim();
    if (!text) continue;

    items.push({
      title: text.slice(0, 200),
      owner,
      dueOn,
      sourceExcerpt: line.slice(0, 300),
    });
  }
  return items;
}
