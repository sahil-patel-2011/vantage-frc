import type { TaskPriority, TaskStatus } from "./types";

/**
 * Task field vocabularies shared by the API validators and the Tasks client.
 *
 * These live apart from `compute-tasks.ts` because that module reaches `@vantage/core`
 * and the roster loader for its DB work. The client component only needs these lists, and
 * importing them from `compute-tasks.ts` pulled the Postgres driver into the browser bundle.
 */

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "archived"];

export const TASK_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];

export const SUBSYSTEM_SUGGESTIONS = [
  "drivetrain",
  "intake",
  "shooter",
  "elevator",
  "arm",
  "climber",
  "electrical",
  "pneumatics",
  "controls",
  "software",
  "vision",
  "fabrication",
  "general",
];
