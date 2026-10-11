import type { TeamTodo, TodoMetrics, TodoStatus } from "./types";

const MS_DAY = 24 * 60 * 60 * 1000;

export function statusLabel(status: TodoStatus): string {
  switch (status) {
    case "todo":
      return "To do";
    case "doing":
      return "Doing";
    case "done":
      return "Done";
  }
}

/** Calendar days from as-of date to due date (negative = overdue). */
export function daysToDue(dueOn: string | null, asOf: string): number | null {
  if (!dueOn) return null;
  const due = Date.parse(`${dueOn}T00:00:00.000Z`);
  const now = Date.parse(`${asOf}T00:00:00.000Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return null;
  return Math.round((due - now) / MS_DAY);
}

export function withFlags(
  todo: Omit<TeamTodo, "flags">,
  asOf: string,
): TeamTodo {
  const days = daysToDue(todo.dueOn, asOf);
  const active = todo.status !== "done";
  return {
    ...todo,
    flags: {
      daysToDue: days,
      overdue: active && days != null && days < 0,
      dueSoon: active && days != null && days >= 0 && days <= 3,
    },
  };
}

export function computeMetrics(todos: TeamTodo[], currentUserId: string): TodoMetrics {
  let todo = 0;
  let doing = 0;
  let done = 0;
  let overdue = 0;
  let dueSoon = 0;
  let mineOpen = 0;
  for (const item of todos) {
    if (item.status === "todo") todo += 1;
    else if (item.status === "doing") doing += 1;
    else done += 1;
    if (item.flags.overdue) overdue += 1;
    if (item.flags.dueSoon) dueSoon += 1;
    if (item.status !== "done" && item.assigneeUserId === currentUserId) mineOpen += 1;
  }
  return {
    total: todos.length,
    todo,
    doing,
    done,
    overdue,
    dueSoon,
    mineOpen,
  };
}

export function sortTodos(todos: TeamTodo[]): TeamTodo[] {
  const statusRank: Record<TodoStatus, number> = { doing: 0, todo: 1, done: 2 };
  return [...todos].sort((a, b) => {
    const sr = statusRank[a.status] - statusRank[b.status];
    if (sr !== 0) return sr;
    if (a.flags.overdue !== b.flags.overdue) return a.flags.overdue ? -1 : 1;
    if (a.flags.dueSoon !== b.flags.dueSoon) return a.flags.dueSoon ? -1 : 1;
    const ad = a.dueOn ?? "9999-99-99";
    const bd = b.dueOn ?? "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function asOfUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * "Today" for due dates: the viewer's own calendar date, sent by their browser, when it is a real
 * date within a day of UTC's (every time zone is). The server's UTC date turned a task due today
 * "Overdue 1d" at 8 PM in Georgia and 5 PM in California, mid build session. Anything else falls
 * back to UTC.
 */
export function resolveAsOf(clientToday: unknown, now: Date = new Date()): string {
  const utc = asOfUtcDate(now);
  if (typeof clientToday !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(clientToday)) return utc;
  const parsed = new Date(`${clientToday}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== clientToday) return utc;
  const diff = daysToDue(clientToday, utc);
  return diff != null && Math.abs(diff) <= 1 ? clientToday : utc;
}

/** This device's calendar date, for `resolveAsOf` on the server. */
export function localDateIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The longest title the database keeps (0162: CHECK char_length(title) BETWEEN 1 AND 200). */
export const TODO_TITLE_MAX = 200;

export const TODO_TITLE_TOO_LONG = `Keep the title to ${TODO_TITLE_MAX} characters. Put the rest in the notes.`;
