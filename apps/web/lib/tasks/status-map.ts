// Status vocabulary bridge between the merged task store (build_tasks) and the
// Soft-UI todo list, which speaks a coarser todo / doing / done. Pure.

import type { TaskStatus } from "./types";

export type CoarseStatus = "todo" | "doing" | "done";

/** build_tasks status -> todo-list status. Archived reads as done. */
export function coarseStatus(status: TaskStatus): CoarseStatus {
  switch (status) {
    case "todo":
      return "todo";
    case "in_progress":
    case "blocked":
      return "doing";
    case "done":
    case "archived":
      return "done";
  }
}

/**
 * todo-list status -> build_tasks status. "doing" keeps a blocked task blocked
 * (the list cannot express blocked, so it must not silently unblock).
 */
export function canonicalStatus(next: CoarseStatus, current: TaskStatus | null): TaskStatus {
  switch (next) {
    case "todo":
      return "todo";
    case "doing":
      return current === "blocked" ? "blocked" : "in_progress";
    case "done":
      return "done";
  }
}

export function isCoarseStatus(value: unknown): value is CoarseStatus {
  return value === "todo" || value === "doing" || value === "done";
}
