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
