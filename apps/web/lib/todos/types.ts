import type { TaskPriority, TaskStatus } from "../tasks/types";

export const TODO_STATUSES = ["todo", "doing", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/**
 * One team task as the Soft-UI todo list sees it. Backed by build_tasks (the
 * merged store, migration 0502): `status` is the coarse list view, `taskStatus`
 * the canonical board status the same row shows on the board columns.
 */
export type TeamTodo = {
  id: string;
  title: string;
  notes: string;
  status: TodoStatus;
  taskStatus: TaskStatus;
  priority: TaskPriority;
  subsystem: string;
  /** Free-text collaborators (board style); assigneeName is the linked member when set. */
  assignees: string[];
  blockedReason: string | null;
  estimateHours: number | null;
  seasonYear: number;
  assigneeUserId: string | null;
  assigneeName: string | null;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
  dueOn: string | null;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  flags: {
    overdue: boolean;
    dueSoon: boolean;
    daysToDue: number | null;
  };
};

export type TodoMember = {
  userId: string;
  name: string;
  role: string;
};

export type TodoSubteam = {
  id: string;
  name: string;
  color: string;
};

export type TodoMetrics = {
  total: number;
  todo: number;
  doing: number;
  done: number;
  overdue: number;
  dueSoon: number;
  mineOpen: number;
};

export type TodosSetupStep = { id: string; label: string; detail: string; href: string };

/** Client-safe view shape returned by /api/todos (no server imports). */
export type TodosView =
  | {
      status: "setup_required";
      message: string;
      steps: TodosSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      currentUserId: string;
      todos: TeamTodo[];
      members: TodoMember[];
      subteams: TodoSubteam[];
      /** Subsystem tags already used on this team's tasks (for the datalist). */
      subsystems: string[];
      metrics: TodoMetrics;
      focusTodoId: string | null;
      computedAt: string;
    };
