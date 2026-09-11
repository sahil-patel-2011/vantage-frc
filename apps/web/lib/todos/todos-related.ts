import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { TeamHubRelatedId } from "../team/team-related";
import type { TeamTodo, TodoStatus } from "./types";

/** Focused Soft-UI Team strip when Todos is open (never DEMO task lists). */
export const TODOS_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "calendar",
  "messages",
  "practice",
];

export type TodoListFilter = "all" | "mine" | "overdue" | TodoStatus;

export const TODO_LIST_FILTERS: Array<{ id: TodoListFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
  { id: "overdue", label: "Overdue" },
];

/** Filter real team_todos rows only — never invents DEMO placeholders. */
export function filterTodos(
  todos: TeamTodo[],
  filter: TodoListFilter,
  currentUserId: string,
): TeamTodo[] {
  return todos.filter((todo) => {
    if (filter === "all") return true;
    if (filter === "mine") return todo.assigneeUserId === currentUserId && todo.status !== "done";
    if (filter === "overdue") return todo.flags.overdue;
    return todo.status === filter;
  });
}

export function todoDeepLink(orgId: string, todoId: string): string {
  return withOrgHref(`/todos?todoId=${encodeURIComponent(todoId)}`, orgId);
}

export type TodosNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Next actions for a ready Todos board.
 * Points at Calendar / Messages / Practice — never invents DEMO task lists.
 * Setup shells keep one EmptyState primary instead of this panel.
 */
export function todosNextActions(input: {
  orgId?: string | null;
  todoCount: number;
  mineOpen: number;
  overdue: number;
}): TodosNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before sharing todos.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: TodosNextAction[] = [];

  if (input.todoCount === 0) {
    actions.push({
      id: "add-first",
      label: "Add the first real todo",
      detail: "The list stays empty until someone on this team creates work.",
      href: hubHref("/team", "todos", orgId),
      primary: true,
    });
    actions.push({
      id: "calendar",
      label: "Plan due dates on Calendar",
      detail: "Block meeting or build time, then tag a todo with a matching subteam.",
      href: hubHref("/team", "calendar", orgId),
    });
    actions.push({
      id: "messages",
      label: "Ask in Messages",
      detail: "Pull assignees from the team channel when owners are still unclear.",
      href: hubHref("/team", "messages", orgId),
    });
    actions.push({
      id: "practice",
      label: "Review Practice sessions",
      detail: "Drive goals often spawn follow-up todos after a session is logged.",
      href: hubHref("/team", "practice", orgId),
    });
    return actions;
  }

  if (input.overdue > 0) {
    actions.push({
      id: "overdue",
      label: `Clear ${input.overdue} overdue todo${input.overdue === 1 ? "" : "s"}`,
      detail: "Due dates come from real rows — reopen Calendar if timing changed.",
      href: hubHref("/team", "todos", orgId),
      primary: true,
    });
    actions.push({
      id: "calendar",
      label: "Reschedule on Calendar",
      detail: "Move the subteam block, then update the todo due date to match.",
      href: hubHref("/team", "calendar", orgId),
    });
  } else if (input.mineOpen > 0) {
    actions.push({
      id: "mine",
      label: `Work your ${input.mineOpen} open todo${input.mineOpen === 1 ? "" : "s"}`,
      detail: "Filter Mine to see only what you own — empty until teammates assign you.",
      href: hubHref("/team", "todos", orgId),
      primary: true,
    });
  }

  actions.push({
    id: "messages",
    label: "Nudge owners in Messages",
    detail: "Link a todo from chat when someone needs context.",
    href: hubHref("/team", "messages", orgId),
    primary: actions.length === 0,
  });
  actions.push({
    id: "practice",
    label: "Check Practice follow-ups",
    detail: "Log reps first; create todos only for real follow-up work.",
    href: hubHref("/team", "practice", orgId),
  });

  return actions;
}
