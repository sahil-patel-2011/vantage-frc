/**
 * One vocabulary for the three work trackers this team already has.
 *
 * `team_todos` (todo/doing/done), `build_tasks` (todo/in_progress/blocked/done/archived) and
 * `season_milestones` / `season_goals` (planned/in_progress/done/dropped) each invented their own
 * status words, their own due-date flags, and their own idea of an owner. Downstream readers —
 * My Day, calendar, notifications, workload — had to know all three. This is the shared shape they
 * agree on; nothing here is a new table, every field maps back to a column that already exists.
 *
 * The canonical status words are the season-plan set (the widest of the three) plus `blocked` from
 * the build board, so nothing is a fourth vocabulary invented for this file.
 */

export const WORK_ITEM_STATUSES = ["planned", "in_progress", "blocked", "done", "dropped"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

/** Which table a canonical item came from. Round-trips back to the right writer. */
export type WorkItemSource = "todo" | "build_task" | "milestone";

/**
 * How confident we are that an owner string points at a specific person.
 *
 * - `member` — the row stores a real `user_id`; there is nothing to guess.
 * - `matched` — free text that resolved to exactly one roster member by exact name.
 * - `unlinked` — free text with no confident match (a guest, an alum, a parent volunteer).
 * - `ambiguous` — free text that could be more than one member. Never auto-linked.
 */
export type WorkItemOwnerLink = "member" | "matched" | "unlinked" | "ambiguous";

export type WorkItemOwner = {
  userId: string | null;
  name: string;
  link: WorkItemOwnerLink;
};

export type WorkItemFlags = {
  /** Calendar days from as-of to due (negative = past due). Null when undated. */
  daysToDue: number | null;
  overdue: boolean;
  dueSoon: boolean;
  open: boolean;
};

export type WorkItem = {
  id: string;
  source: WorkItemSource;
  orgId: string;
  title: string;
  status: WorkItemStatus;
  /** ISO date (YYYY-MM-DD) or null — the single due-date field all three trackers agree on. */
  dueOn: string | null;
  owners: WorkItemOwner[];
  /** Free-text grouping: todo subteam name, task subsystem, or goal category. */
  grouping: string | null;
  subteamId: string | null;
  createdAt: string | null;
  completedAt: string | null;
  href: string;
  flags: WorkItemFlags;
};

/** A due-dated work item projected onto the team calendar. */
export type WorkItemCalendarEntry = {
  id: string;
  source: WorkItemSource;
  date: string;
  title: string;
  href: string;
  status: WorkItemStatus;
  overdue: boolean;
};
