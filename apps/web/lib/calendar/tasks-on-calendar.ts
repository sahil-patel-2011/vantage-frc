// Tasks on the calendar — the Google Calendar / Google Tasks pairing.
//
// A team already keeps tasks in `team_todos` (0162): title, status, assignee,
// subteam, and a `due_on` date. Until now the calendar showed events, duties,
// travel legs, GitHub milestones and TBA matches, but not the tasks — so "what
// is due this week" and "what is happening this week" were two different pages.
// This is the overlay that puts them on the same grid.
//
// `due_on` is a DATE, not a timestamptz. That is a feature here: a task due on
// the 15th is due on the 15th in every browser, so its day key needs no zone
// conversion and cannot drift across a timezone the way an instant would. It
// also means a task has no hour, which is why these render in the all-day strip
// rather than being placed at a time we would have had to invent.

export type TaskOnCalendar = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  /** `YYYY-MM-DD`, straight from the DATE column. Never null in the overlay. */
  dueOn: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
};

/** Same subteam rule as events: a subteam filter still shows whole-team rows. */
export function filterTasksBySubteam(
  tasks: readonly TaskOnCalendar[],
  subteamId: string | null,
): TaskOnCalendar[] {
  if (!subteamId) return [...tasks];
  return tasks.filter((task) => task.subteamId == null || task.subteamId === subteamId);
}

/**
 * Bucket tasks by their due day.
 *
 * Done tasks are dropped: a calendar is about what is still ahead of you, and
 * a month grid full of ticked-off work buries the three things that are not.
 * They stay on /todos, which is where the record of what got done belongs.
 */
export function tasksByDay(tasks: readonly TaskOnCalendar[]): Map<string, TaskOnCalendar[]> {
  const byDay = new Map<string, TaskOnCalendar[]>();
  for (const task of tasks) {
    if (task.status === "done") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(task.dueOn)) continue;
    const bucket = byDay.get(task.dueOn);
    if (bucket) bucket.push(task);
    else byDay.set(task.dueOn, [task]);
  }
  for (const bucket of byDay.values()) {
    // Started work first, then alphabetical, so the order is stable between
    // renders rather than whatever the query happened to return.
    bucket.sort(
      (a, b) =>
        (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) ||
        a.title.localeCompare(b.title),
    );
  }
  return byDay;
}

/**
 * Is this task late, as of `today`?
 *
 * Compared as day strings, not as Date objects: both sides are already
 * `YYYY-MM-DD` in the same calendar, and lexicographic order on that format is
 * chronological order. Parsing them into Dates would only add a chance to pick
 * up a zone offset and call something overdue a few hours early.
 */
export function isOverdue(task: TaskOnCalendar, today: string): boolean {
  if (task.status === "done") return false;
  return task.dueOn < today;
}

/** Counts for the strip's summary line. Only ever what is really there. */
export function taskSummary(
  tasks: readonly TaskOnCalendar[],
  today: string,
): { open: number; overdue: number; dueToday: number } {
  let open = 0;
  let overdue = 0;
  let dueToday = 0;
  for (const task of tasks) {
    if (task.status === "done") continue;
    open += 1;
    if (isOverdue(task, today)) overdue += 1;
    else if (task.dueOn === today) dueToday += 1;
  }
  return { open, overdue, dueToday };
}
