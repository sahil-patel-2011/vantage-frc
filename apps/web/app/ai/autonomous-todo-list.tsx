import type { WorkingTodoStatus } from "@vantage/agent";
import {
  classifyWorkingTodosPane,
  workingTodosPaneCopy,
} from "../../lib/agent/working-todos-pane";

export type AutonomousTodoItem = {
  id: string;
  label: string;
  status: WorkingTodoStatus | string;
};

function labelTodoStatus(status: string): string {
  switch (status) {
    case "pending":
      return "To do";
    case "in_progress":
      return "Working";
    case "done":
      return "Done";
    case "blocked":
      return "Blocked";
    default:
      return status.replaceAll("_", " ");
  }
}

export function AutonomousTodoList({
  todos,
  setupRequired = false,
  selected = true,
}: {
  todos: readonly AutonomousTodoItem[];
  setupRequired?: boolean;
  selected?: boolean;
}) {
  const kind = classifyWorkingTodosPane({
    selected,
    setupRequired,
    todoCount: todos.length,
  });
  switch (kind) {
    case "hidden":
      return null;
    case "setup": {
      const copy = workingTodosPaneCopy("setup");
      return (
        <section className="aa-todos" aria-label="Working todos">
          <h3>Checklist</h3>
          <p className="aa-todo-setup">
            <span className="aa-status aa-status--setup_required">{copy.badge}</span>
            {copy.description}
          </p>
        </section>
      );
    }
    case "empty": {
      const copy = workingTodosPaneCopy("empty");
      return (
        <section className="aa-todos" aria-label="Working todos">
          <h3>Checklist</h3>
          <p className="aa-muted">{copy.description}</p>
        </section>
      );
    }
    case "ready":
      return (
        <section className="aa-todos" aria-label="Working todos">
          <h3>Checklist</h3>
          <ul className="aa-todo-list">
            {todos.map((todo, index) => (
              <li
                key={todo.id}
                className={`aa-todo aa-todo--${todo.status} qol-stagger-row`}
                style={{ ["--qol-i" as string]: index }}
              >
                <span className="aa-todo-mark" aria-hidden="true">
                  {todo.status === "done" ? "✓" : todo.status === "in_progress" ? "•" : "○"}
                </span>
                <span className="aa-todo-label">{todo.label}</span>
                <span className="aa-todo-status">{labelTodoStatus(todo.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}
