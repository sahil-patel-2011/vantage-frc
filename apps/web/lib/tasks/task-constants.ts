/**
 * Task enums and suggestions that are safe to import from a Client Component.
 *
 * Nothing here may import `@vantage/core` or anything reaching `@vantage/db`:
 * `packages/db/src/pool.ts` pulls the Node pg driver, whose `dns`, `net`, `tls`
 * and `fs` the browser bundle cannot resolve. `./compute-tasks` does import
 * those (it emits notifications and reads the roster), so a client that wants
 * only these lists takes them from here and the production build stops failing
 * with "Module not found: Can't resolve 'dns'".
 *
 * `./compute-tasks` re-exports these, so server callers keep one import.
 */
import type { TaskPriority, TaskStatus } from "./types";

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
