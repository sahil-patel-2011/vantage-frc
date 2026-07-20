/** Client-safe todos barrel — never re-export compute-todos (@vantage/core). */
export { asOfUtcDate, computeMetrics, daysToDue, sortTodos, statusLabel, withFlags } from "./evaluate";
export {
  TODO_LIST_FILTERS,
  TODOS_RELATED_INCLUDE,
  filterTodos,
  todoDeepLink,
  todosNextActions,
  type TodoListFilter,
  type TodosNextAction,
} from "./todos-related";
export type {
  TeamTodo,
  TodoMember,
  TodoMetrics,
  TodoStatus,
  TodoSubteam,
  TodosSetupStep,
  TodosView,
} from "./types";
export { TODO_STATUSES } from "./types";
