/**
 * Pure adapter between the three work trackers and the canonical `WorkItem` shape.
 *
 * No I/O, no framework imports — the DB side lives in ./service.ts. Everything here is a total
 * function over data the caller already loaded, so the mapping rules are testable on their own.
 *
 * Owner resolution deliberately reuses `matchPersonName` from presence rather than inventing a
 * second matcher: the rule that two people are never silently merged has to hold everywhere a
 * free-text name is turned into a member id, not just in attendance.
 */

import { matchPersonName, type RosterMember } from "../presence/match-names";
import type {
  WorkItem,
  WorkItemCalendarEntry,
  WorkItemFlags,
  WorkItemOwner,
  WorkItemSource,
  WorkItemStatus,
} from "./types";

const MS_DAY = 24 * 60 * 60 * 1000;

/** Matches the 3-day window todos and the build board were already using independently. */
export const DUE_SOON_DAYS = 3;

const OPEN_STATUSES: ReadonlySet<WorkItemStatus> = new Set<WorkItemStatus>([
  "planned",
  "in_progress",
  "blocked",
]);

export function isOpenStatus(status: WorkItemStatus): boolean {
  return OPEN_STATUSES.has(status);
}

export function statusLabel(status: WorkItemStatus): string {
  const labels: Record<WorkItemStatus, string> = {
    planned: "Planned",
    in_progress: "In progress",
    blocked: "Blocked",
    done: "Done",
    dropped: "Dropped",
  };
  return labels[status];
}

// ---- status translation (each direction is explicit; nothing falls through to a default) ----

export function fromTodoStatus(status: string): WorkItemStatus {
  switch (status) {
    case "doing":
      return "in_progress";
    case "done":
      return "done";
    default:
      return "planned";
  }
}

export function fromTaskStatus(status: string): WorkItemStatus {
  switch (status) {
    case "in_progress":
      return "in_progress";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "archived":
      return "dropped";
    default:
      return "planned";
  }
}

export function fromMilestoneStatus(status: string): WorkItemStatus {
  switch (status) {
    case "in_progress":
      return "in_progress";
    case "done":
      return "done";
    case "dropped":
      return "dropped";
    default:
      return "planned";
  }
}

/**
 * Canonical -> `team_todos.status`. Todos have no blocked or dropped column, so those are not
 * representable; returning null makes the caller decide rather than quietly writing "doing".
 */
export function toTodoStatus(status: WorkItemStatus): "todo" | "doing" | "done" | null {
  switch (status) {
    case "planned":
      return "todo";
    case "in_progress":
      return "doing";
    case "done":
      return "done";
    default:
      return null;
  }
}

export function toTaskStatus(
  status: WorkItemStatus,
): "todo" | "in_progress" | "blocked" | "done" | "archived" {
  switch (status) {
    case "in_progress":
      return "in_progress";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "dropped":
      return "archived";
    default:
      return "todo";
  }
}

export function toMilestoneStatus(
  status: WorkItemStatus,
): "planned" | "in_progress" | "done" | "dropped" {
  switch (status) {
    case "in_progress":
    case "blocked":
      return "in_progress";
    case "done":
      return "done";
    case "dropped":
      return "dropped";
    default:
      return "planned";
  }
}

// ---- due dates ----

export function asOfUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysToDue(dueOn: string | null, asOf: string): number | null {
  if (!dueOn) return null;
  const due = Date.parse(`${dueOn.slice(0, 10)}T00:00:00.000Z`);
  const now = Date.parse(`${asOf.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return null;
  return Math.round((due - now) / MS_DAY);
}

/** One overdue/due-soon rule for all three trackers, instead of three that drifted apart. */
export function workItemFlags(
  input: { dueOn: string | null; status: WorkItemStatus },
  asOf: string,
): WorkItemFlags {
  const open = isOpenStatus(input.status);
  const days = daysToDue(input.dueOn, asOf);
  return {
    daysToDue: days,
    overdue: open && days != null && days < 0,
    dueSoon: open && days != null && days >= 0 && days <= DUE_SOON_DAYS,
    open,
  };
}

// ---- owners ----

export function memberOwner(userId: string, name: string | null | undefined): WorkItemOwner {
  return { userId, name: (name ?? "").trim() || "Member", link: "member" };
}

/**
 * Resolve one free-text owner name against the roster. Only a single exact name match produces a
 * user id; a nickname, an initial, or a shared surname stays unlinked so nobody's work is
 * silently attributed to the wrong person.
 */
export function resolveOwnerName(name: string, roster: RosterMember[]): WorkItemOwner {
  const trimmed = name.trim();
  if (!trimmed) return { userId: null, name: "", link: "unlinked" };
  const match = matchPersonName(trimmed, roster);
  if (match.resolution === "auto" && match.autoUserId) {
    const exact = match.candidates[0];
    return { userId: match.autoUserId, name: exact?.name || trimmed, link: "matched" };
  }
  return { userId: null, name: trimmed, link: match.resolution === "ambiguous" ? "ambiguous" : "unlinked" };
}

export function resolveOwnerNames(names: string[], roster: RosterMember[]): WorkItemOwner[] {
  const seen = new Set<string>();
  const owners: WorkItemOwner[] = [];
  for (const name of names) {
    const owner = resolveOwnerName(name, roster);
    if (!owner.name) continue;
    const key = owner.userId ?? `name:${owner.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    owners.push(owner);
  }
  return owners;
}

/**
 * The canonical name to STORE back into a free-text owner column. Writing the roster's spelling
 * instead of whatever was typed is what stops "sam r", "Sam R." and "Sam Rodriguez" becoming three
 * different owners on the same board.
 */
export function canonicalOwnerName(name: string, roster: RosterMember[]): string {
  const owner = resolveOwnerName(name, roster);
  return owner.name;
}

// ---- item mapping ----

function orgParam(orgId: string): string {
  return `orgId=${encodeURIComponent(orgId)}`;
}

export function workItemHref(source: WorkItemSource, orgId: string, id: string): string {
  switch (source) {
    case "todo":
      return `/todos?${orgParam(orgId)}&todoId=${encodeURIComponent(id)}`;
    case "build_task":
      return `/tasks?${orgParam(orgId)}&taskId=${encodeURIComponent(id)}`;
    case "milestone":
      return `/season-planning-workspace?${orgParam(orgId)}&milestoneId=${encodeURIComponent(id)}`;
  }
}

export type TodoInput = {
  id: string;
  title: string;
  status: string;
  dueOn: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  subteamId: string | null;
  subteamName: string | null;
  createdAt: string | null;
  completedAt: string | null;
};

export function fromTodo(row: TodoInput, orgId: string, asOf: string): WorkItem {
  const status = fromTodoStatus(row.status);
  return {
    id: row.id,
    source: "todo",
    orgId,
    title: row.title,
    status,
    dueOn: row.dueOn,
    owners: row.assigneeUserId ? [memberOwner(row.assigneeUserId, row.assigneeName)] : [],
    grouping: row.subteamName,
    subteamId: row.subteamId,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    href: workItemHref("todo", orgId, row.id),
    flags: workItemFlags({ dueOn: row.dueOn, status }, asOf),
  };
}

export type BuildTaskInput = {
  id: string;
  title: string;
  status: string;
  dueOn: string | null;
  assignees: string[];
  subsystem: string | null;
  createdAt: string | null;
  doneAt: string | null;
};

export function fromBuildTask(
  row: BuildTaskInput,
  orgId: string,
  asOf: string,
  roster: RosterMember[],
): WorkItem {
  const status = fromTaskStatus(row.status);
  return {
    id: row.id,
    source: "build_task",
    orgId,
    title: row.title,
    status,
    dueOn: row.dueOn,
    owners: resolveOwnerNames(row.assignees, roster),
    grouping: row.subsystem,
    subteamId: null,
    createdAt: row.createdAt,
    completedAt: row.doneAt,
    href: workItemHref("build_task", orgId, row.id),
    flags: workItemFlags({ dueOn: row.dueOn, status }, asOf),
  };
}

export type MilestoneInput = {
  id: string;
  title: string;
  status: string;
  dueOn: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  category: string | null;
  createdAt: string | null;
};

export function fromMilestone(row: MilestoneInput, orgId: string, asOf: string): WorkItem {
  const status = fromMilestoneStatus(row.status);
  return {
    id: row.id,
    source: "milestone",
    orgId,
    title: row.title,
    status,
    dueOn: row.dueOn,
    owners: row.ownerUserId ? [memberOwner(row.ownerUserId, row.ownerName)] : [],
    grouping: row.category,
    subteamId: null,
    createdAt: row.createdAt,
    completedAt: null,
    href: workItemHref("milestone", orgId, row.id),
    flags: workItemFlags({ dueOn: row.dueOn, status }, asOf),
  };
}

// ---- derived reads (these are what "downstream agrees" means in practice) ----

const STATUS_RANK: Record<WorkItemStatus, number> = {
  blocked: 0,
  in_progress: 1,
  planned: 2,
  done: 3,
  dropped: 4,
};

/** Overdue first, then blocked/active work, then soonest due. Stable for undated items. */
export function sortWorkItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    if (a.flags.overdue !== b.flags.overdue) return a.flags.overdue ? -1 : 1;
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;
    const aDue = a.dueOn ?? "9999-12-31";
    const bDue = b.dueOn ?? "9999-12-31";
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export function ownedBy(items: WorkItem[], userId: string): WorkItem[] {
  return items.filter((item) => item.owners.some((owner) => owner.userId === userId));
}

export type WorkItemSummary = {
  total: number;
  open: number;
  blocked: number;
  done: number;
  overdue: number;
  dueSoon: number;
  unowned: number;
  /** Open items whose owner is free text we could not confidently link to a member. */
  unlinkedOwners: number;
  bySource: Record<WorkItemSource, number>;
};

export function summarizeWorkItems(items: WorkItem[]): WorkItemSummary {
  const bySource: Record<WorkItemSource, number> = { todo: 0, build_task: 0, milestone: 0 };
  let open = 0;
  let blocked = 0;
  let done = 0;
  let overdue = 0;
  let dueSoon = 0;
  let unowned = 0;
  let unlinkedOwners = 0;

  for (const item of items) {
    bySource[item.source] += 1;
    if (item.flags.open) open += 1;
    if (item.status === "blocked") blocked += 1;
    if (item.status === "done") done += 1;
    if (item.flags.overdue) overdue += 1;
    if (item.flags.dueSoon) dueSoon += 1;
    if (item.flags.open && item.owners.length === 0) unowned += 1;
    if (item.flags.open && item.owners.some((owner) => owner.link !== "member" && !owner.userId)) {
      unlinkedOwners += 1;
    }
  }

  return { total: items.length, open, blocked, done, overdue, dueSoon, unowned, unlinkedOwners, bySource };
}

/**
 * Due-dated open work, as calendar entries. One projection for all three trackers so a due date
 * means the same thing on the calendar whichever tracker it was set in.
 */
export function workItemCalendarEntries(items: WorkItem[]): WorkItemCalendarEntry[] {
  return items
    .filter((item) => item.dueOn && item.flags.open)
    .map((item) => ({
      id: item.id,
      source: item.source,
      date: item.dueOn!.slice(0, 10),
      title: item.title,
      href: item.href,
      status: item.status,
      overdue: item.flags.overdue,
    }))
    .sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date)));
}

/**
 * Per-member workload from resolved owner ids only. The board's old version matched on lower-cased
 * names, so an unlinked "sam r" silently counted against the member called "Sam Rodriguez".
 */
export function workloadByMember(
  members: Array<{ userId: string; name: string }>,
  items: WorkItem[],
): Array<{ userId: string; name: string; open: number; overdue: number; blocked: number }> {
  return members.map((member) => {
    const mine = items.filter(
      (item) => item.flags.open && item.owners.some((owner) => owner.userId === member.userId),
    );
    return {
      userId: member.userId,
      name: member.name,
      open: mine.length,
      overdue: mine.filter((item) => item.flags.overdue).length,
      blocked: mine.filter((item) => item.status === "blocked").length,
    };
  });
}
