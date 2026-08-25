// Part Manufacturing kanban — pure helpers. No I/O, unit-testable in isolation.
//
// The board is a STATE MACHINE, not free movement: allowedTransitions() is the single
// source of truth for which moves exist, and the API refuses anything else.

import type {
  CycleTimeSummary,
  ManufacturingMethod,
  ManufacturingPart,
  ManufacturingPriority,
  ManufacturingState,
  ManufacturingStateEvent,
  SubsystemCoverageRow,
  SubsystemOption,
} from "./types";

export const KANBAN_STATES: ManufacturingState[] = [
  "needs_design",
  "needs_cam",
  "ready_to_cut",
  "in_progress",
  "needs_finishing",
  "done",
  "scrapped",
];

export const MANUFACTURING_METHODS: ManufacturingMethod[] = [
  "mill",
  "lathe",
  "router",
  "waterjet",
  "laser",
  "3d_print",
  "bandsaw",
  "sheet_bend",
  "cots",
  "assembly",
  "other",
];

export const MANUFACTURING_PRIORITIES: ManufacturingPriority[] = ["low", "normal", "high", "critical"];

/** Below this many finished parts, cycle-time is null — never a fabricated average. */
export const MIN_COMPLETED_FOR_CYCLE_TIME = 5;

const TRANSITIONS: Record<ManufacturingState, ManufacturingState[]> = {
  // Forward to CAM (or straight to the queue for COTS/no-CAM work), back never needed.
  needs_design: ["needs_cam", "ready_to_cut", "scrapped"],
  // CAM done -> queue; design changed -> back to design.
  needs_cam: ["needs_design", "ready_to_cut", "scrapped"],
  // Machine free -> start; CAM redo -> back.
  ready_to_cut: ["needs_cam", "in_progress", "scrapped"],
  // Off the machine -> finishing or straight to done; bumped off -> back to queue.
  in_progress: ["ready_to_cut", "needs_finishing", "done", "scrapped"],
  needs_finishing: ["in_progress", "done", "scrapped"],
  // Reopen paths only.
  done: ["needs_finishing", "scrapped"],
  scrapped: ["needs_design", "needs_cam", "ready_to_cut"],
};

export function allowedTransitions(state: ManufacturingState): ManufacturingState[] {
  return TRANSITIONS[state] ?? [];
}

export function isAllowedTransition(from: ManufacturingState, to: ManufacturingState): boolean {
  return allowedTransitions(from).includes(to);
}

/** The single forward move a card's advance button offers; null for terminal states. */
export function advanceTarget(state: ManufacturingState): ManufacturingState | null {
  switch (state) {
    case "needs_design":
      return "needs_cam";
    case "needs_cam":
      return "ready_to_cut";
    case "ready_to_cut":
      return "in_progress";
    case "in_progress":
      return "needs_finishing";
    case "needs_finishing":
      return "done";
    default:
      return null;
  }
}

export function stateLabel(state: ManufacturingState): string {
  switch (state) {
    case "needs_design":
      return "Needs design";
    case "needs_cam":
      return "Needs CAM";
    case "ready_to_cut":
      return "Ready to cut";
    case "in_progress":
      return "In progress";
    case "needs_finishing":
      return "Needs finishing";
    case "done":
      return "Done";
    case "scrapped":
      return "Scrapped";
  }
}

export function advanceLabel(state: ManufacturingState): string | null {
  switch (state) {
    case "needs_design":
      return "Send to CAM";
    case "needs_cam":
      return "Mark ready to cut";
    case "ready_to_cut":
      return "Start cutting";
    case "in_progress":
      return "Send to finishing";
    case "needs_finishing":
      return "Mark done";
    default:
      return null;
  }
}

export function methodLabel(method: ManufacturingMethod): string {
  switch (method) {
    case "mill":
      return "Mill";
    case "lathe":
      return "Lathe";
    case "router":
      return "Router";
    case "waterjet":
      return "Waterjet";
    case "laser":
      return "Laser";
    case "3d_print":
      return "3D print";
    case "bandsaw":
      return "Bandsaw";
    case "sheet_bend":
      return "Sheet bend";
    case "cots":
      return "COTS";
    case "assembly":
      return "Assembly";
    default:
      return "Other";
  }
}

export function priorityLabel(priority: ManufacturingPriority): string {
  switch (priority) {
    case "low":
      return "Low";
    case "normal":
      return "Normal";
    case "high":
      return "High";
    case "critical":
      return "Critical";
  }
}

const PRIORITY_RANK: Record<ManufacturingPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Groups parts into board columns, KANBAN_STATES order, priority then needed-by within a column. */
export function groupByState(parts: ManufacturingPart[]): Map<ManufacturingState, ManufacturingPart[]> {
  const groups = new Map<ManufacturingState, ManufacturingPart[]>();
  for (const state of KANBAN_STATES) groups.set(state, []);
  for (const part of parts) {
    const bucket = groups.get(part.state);
    if (bucket) bucket.push(part);
  }
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => {
      const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (rank !== 0) return rank;
      if (a.neededBy && b.neededBy && a.neededBy !== b.neededBy) return a.neededBy < b.neededBy ? -1 : 1;
      if (a.neededBy && !b.neededBy) return -1;
      if (!a.neededBy && b.neededBy) return 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
  }
  return groups;
}

/**
 * Parts past their needed-by date that are not done or scrapped, most overdue first.
 * Parts with NO needed_by are deliberately excluded — they are flagged separately
 * (partsMissingDueDate) rather than defaulted onto the risk strip.
 */
export function atRiskParts(input: { parts: ManufacturingPart[]; today: string }): ManufacturingPart[] {
  return input.parts
    .filter(
      (part) =>
        part.neededBy != null &&
        part.neededBy < input.today &&
        part.state !== "done" &&
        part.state !== "scrapped",
    )
    .sort((a, b) => ((a.neededBy as string) < (b.neededBy as string) ? -1 : 1));
}

/** Open parts with no due date — flagged as 'no due date', never given a fabricated one. */
export function partsMissingDueDate(parts: ManufacturingPart[]): ManufacturingPart[] {
  return parts.filter((part) => part.neededBy == null && part.state !== "done" && part.state !== "scrapped");
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Average hours spent in each working state, computed from the append-only event log,
 * over parts that actually reached 'done'. Returns null under
 * MIN_COMPLETED_FOR_CYCLE_TIME completed parts — an honest "not enough finished parts
 * yet", never an estimate.
 */
export function cycleTimeByState(events: ManufacturingStateEvent[]): CycleTimeSummary {
  const byPart = new Map<string, ManufacturingStateEvent[]>();
  for (const event of events) {
    const list = byPart.get(event.partId) ?? [];
    list.push(event);
    byPart.set(event.partId, list);
  }

  const dwell = new Map<ManufacturingState, { totalHours: number; samples: number }>();
  let completedParts = 0;

  for (const list of byPart.values()) {
    const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (!sorted.some((event) => event.toState === "done")) continue;
    completedParts += 1;
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (!current || !next) continue;
      const state = current.toState;
      if (state === "done" || state === "scrapped") continue;
      const entered = Date.parse(current.createdAt);
      const left = Date.parse(next.createdAt);
      if (!Number.isFinite(entered) || !Number.isFinite(left) || left < entered) continue;
      const bucket = dwell.get(state) ?? { totalHours: 0, samples: 0 };
      bucket.totalHours += (left - entered) / MS_PER_HOUR;
      bucket.samples += 1;
      dwell.set(state, bucket);
    }
  }

  if (completedParts < MIN_COMPLETED_FOR_CYCLE_TIME) return null;

  const byState = KANBAN_STATES.filter((state) => dwell.has(state)).map((state) => {
    const bucket = dwell.get(state) as { totalHours: number; samples: number };
    return { state, avgHours: Math.round((bucket.totalHours / bucket.samples) * 10) / 10 };
  });

  return { completedParts, byState };
}

/** Per-subsystem part counts (plus an 'Unassigned' row when parts have no subsystem). */
export function subsystemCoverage(
  parts: ManufacturingPart[],
  subsystems: SubsystemOption[],
): SubsystemCoverageRow[] {
  const rows: SubsystemCoverageRow[] = [];
  for (const subsystem of subsystems) {
    const mine = parts.filter((part) => part.subsystemId === subsystem.id);
    if (mine.length === 0) continue;
    rows.push({
      subsystemId: subsystem.id,
      subsystemName: subsystem.name,
      total: mine.length,
      done: mine.filter((part) => part.state === "done").length,
      active: mine.filter((part) => part.state !== "done" && part.state !== "scrapped").length,
    });
  }
  const unassigned = parts.filter(
    (part) => part.subsystemId == null || !subsystems.some((s) => s.id === part.subsystemId),
  );
  if (unassigned.length > 0) {
    rows.push({
      subsystemId: null,
      subsystemName: "Unassigned",
      total: unassigned.length,
      done: unassigned.filter((part) => part.state === "done").length,
      active: unassigned.filter((part) => part.state !== "done" && part.state !== "scrapped").length,
    });
  }
  return rows.sort((a, b) => b.active - a.active || b.total - a.total);
}
