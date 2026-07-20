export const TODO_STATUSES = ["todo", "doing", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export type TeamTodo = {
  id: string;
  title: string;
  notes: string;
  status: TodoStatus;
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
      metrics: TodoMetrics;
      focusTodoId: string | null;
      computedAt: string;
    };

