export type WorkingTodosPaneKind = "hidden" | "setup" | "empty" | "ready";

export function classifyWorkingTodosPane(input: {
  selected: boolean;
  setupRequired: boolean;
  todoCount: number;
}): WorkingTodosPaneKind {
  if (!input.selected) return "hidden";
  if (input.setupRequired) return "setup";
  if (input.todoCount > 0) return "ready";
  return "empty";
}

export function workingTodosPaneCopy(kind: "setup" | "empty"): {
  badge: string | null;
  title: string;
  description: string;
} {
  switch (kind) {
    case "setup":
      return {
        badge: "Needs setup",
        title: "Checklist needs a database update",
        description: "Working todos are not available until an admin applies the latest migrations.",
      };
    case "empty":
      return {
        badge: null,
        title: "No checklist items yet",
        description: "The agent writes todos as it works. Nothing is listed for this run.",
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}
