// Autonomous routine library. Teams run several auto modes and need to know
// which are competition-ready from each starting position, what each is worth,
// and what still needs testing. Distinct from strategy (match planning) and code
// review (static analysis) — this is a catalog of the team's auto programs.

export const START_POSITIONS = ["left", "center", "right", "other"] as const;
export type StartPosition = (typeof START_POSITIONS)[number];

export const AUTO_STATUSES = ["concept", "coding", "tested", "competition_ready", "retired"] as const;
export type AutoStatus = (typeof AUTO_STATUSES)[number];

export const AUTO_PRIORITIES = ["low", "normal", "high"] as const;
export type AutoPriority = (typeof AUTO_PRIORITIES)[number];

export const AUTO_STATUS_LABEL: Record<AutoStatus, string> = {
  concept: "Concept",
  coding: "Coding",
  tested: "Tested",
  competition_ready: "Competition-ready",
  retired: "Retired",
};

/** Tested and competition-ready both count as "proven on the field / in practice". */
const PROVEN: AutoStatus[] = ["tested", "competition_ready"];

export type RoutineInput = {
  name: string;
  startPosition: StartPosition;
  status: AutoStatus;
  priority: AutoPriority;
  estimatedPoints: number | null;
  description: string;
  pathNotes: string;
};

export function validateRoutine(raw: Record<string, unknown>): { ok: true; value: RoutineInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Routine name is required" };
  const startPosition = String(raw.startPosition ?? "center");
  if (!START_POSITIONS.includes(startPosition as StartPosition)) return { ok: false, error: "Invalid start position" };
  const status = String(raw.status ?? "concept");
  if (!AUTO_STATUSES.includes(status as AutoStatus)) return { ok: false, error: "Invalid status" };
  const priority = String(raw.priority ?? "normal");
  if (!AUTO_PRIORITIES.includes(priority as AutoPriority)) return { ok: false, error: "Invalid priority" };
  let estimatedPoints: number | null = null;
  if (raw.estimatedPoints !== undefined && raw.estimatedPoints !== null && raw.estimatedPoints !== "") {
    estimatedPoints = Number(raw.estimatedPoints);
    if (!Number.isInteger(estimatedPoints) || estimatedPoints < 0) return { ok: false, error: "Estimated points must be a non-negative whole number" };
  }
  return {
    ok: true,
    value: {
      name,
      startPosition: startPosition as StartPosition,
      status: status as AutoStatus,
      priority: priority as AutoPriority,
      estimatedPoints,
      description: typeof raw.description === "string" ? raw.description.trim() : "",
      pathNotes: typeof raw.pathNotes === "string" ? raw.pathNotes.trim() : "",
    },
  };
}

export function summarizeRoutines(routines: { status: AutoStatus; priority: AutoPriority; startPosition: StartPosition; estimatedPoints: number | null }[]) {
  const active = routines.filter((r) => r.status !== "retired");
  const ready = active.filter((r) => r.status === "competition_ready");
  // Which start positions have at least one competition-ready routine — you want
  // a proven auto available from wherever you're placed on the field.
  const coveredPositions = new Set(ready.map((r) => r.startPosition));
  const bestPoints = ready.reduce((max, r) => Math.max(max, r.estimatedPoints ?? 0), 0);
  return {
    total: active.length,
    ready: ready.length,
    proven: active.filter((r) => PROVEN.includes(r.status)).length,
    coveredStartPositions: [...coveredPositions],
    highPriorityUnproven: active.filter((r) => r.priority === "high" && !PROVEN.includes(r.status)).length,
    bestReadyPoints: bestPoints || null,
  };
}

// ---- request validation --------------------------------------------------

export type AutoRoutineAction =
  | ({ action: "create_routine"; orgId: string; seasonYear: number } & RoutineInput)
  | { action: "update_routine"; orgId: string; id: string; patch: RoutineInput }
  | { action: "set_status"; orgId: string; id: string; status: AutoStatus }
  | { action: "delete_routine"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseAutoRoutineAction(raw: unknown): AutoRoutineAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_routine": {
      const validated = validateRoutine(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "update_routine": {
      const validated = validateRoutine(body);
      if (!validated.ok) throw new Error(validated.error);
      return { action, orgId, id: reqStr(body.id, "id"), patch: validated.value };
    }
    case "set_status": {
      const status = reqStr(body.status, "status");
      if (!AUTO_STATUSES.includes(status as AutoStatus)) throw new Error("Invalid status");
      return { action, orgId, id: reqStr(body.id, "id"), status: status as AutoStatus };
    }
    case "delete_routine":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported auto routine action");
  }
}
