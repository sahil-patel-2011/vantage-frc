// Shop steps (0737) — pure shapes and rules, safe to import from client code.
//
// A part's steps are the jobs it goes through on the floor, in order. The step
// list never replaces the kanban state; these helpers only say when a step
// change should also move the part along the existing state machine.

import type { ManufacturingMethod, ManufacturingState, MemberOption } from "./types";

export const STEP_STATUSES = ["todo", "doing", "done"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export type ShopStep = {
  id: string;
  partId: string;
  position: number;
  title: string;
  machine: string | null;
  notes: string | null;
  status: StepStatus;
  workedBy: string | null;
  workedByName: string | null;
  startedAt: string | null;
  doneAt: string | null;
};

export type ShopPart = {
  id: string;
  partName: string;
  quantity: number;
  method: ManufacturingMethod;
  state: ManufacturingState;
  material: string | null;
  neededBy: string | null;
  subsystemName: string | null;
  drawingUrl: string | null;
  steps: ShopStep[];
};

export type ShopStepsView =
  | { status: "setup_required"; reason: "no_team" | "migration"; message: string; orgId: string | null }
  | {
      status: "live";
      orgId: string;
      /** False for a view-only member: they can follow the shop but not press anything. */
      canEdit: boolean;
      parts: ShopPart[];
      members: MemberOption[];
      computedAt: string;
    };

export const MAX_STEPS_PER_PART = 30;

/** Starter steps per machine, so a part gets a sensible list in one tap. Teams edit from there. */
export const STEP_TEMPLATES: Partial<Record<ManufacturingMethod, Array<{ title: string; machine: string | null }>>> = {
  mill: [
    { title: "Cut stock to size", machine: "Bandsaw" },
    { title: "Fixture and zero", machine: "Mill" },
    { title: "Mill profile and pockets", machine: "Mill" },
    { title: "Drill and tap holes", machine: "Mill" },
    { title: "Deburr", machine: null },
  ],
  lathe: [
    { title: "Cut stock to length", machine: "Bandsaw" },
    { title: "Face and turn", machine: "Lathe" },
    { title: "Drill and bore", machine: "Lathe" },
    { title: "Part off and deburr", machine: "Lathe" },
  ],
  router: [
    { title: "Load sheet and zero", machine: "Router" },
    { title: "Run the cut", machine: "Router" },
    { title: "Break out tabs and deburr", machine: null },
  ],
  waterjet: [
    { title: "Nest and load sheet", machine: "Waterjet" },
    { title: "Run the cut", machine: "Waterjet" },
    { title: "Deburr", machine: null },
  ],
  laser: [
    { title: "Nest and load sheet", machine: "Laser" },
    { title: "Run the cut", machine: "Laser" },
    { title: "Clean edges", machine: null },
  ],
  "3d_print": [
    { title: "Slice and check settings", machine: "3D printer" },
    { title: "Print", machine: "3D printer" },
    { title: "Remove supports and clean up", machine: null },
  ],
  bandsaw: [
    { title: "Mark and cut to length", machine: "Bandsaw" },
    { title: "Deburr", machine: null },
  ],
  sheet_bend: [
    { title: "Cut flat blank", machine: null },
    { title: "Bend", machine: "Brake" },
    { title: "Deburr", machine: null },
  ],
  assembly: [
    { title: "Gather parts and hardware", machine: null },
    { title: "Assemble", machine: null },
    { title: "Check fit and function", machine: null },
  ],
};

export function stepTemplate(method: ManufacturingMethod): Array<{ title: string; machine: string | null }> {
  return STEP_TEMPLATES[method] ?? [];
}

/** The step a person should do next: the one in progress, else the first not done. */
export function currentStep(steps: readonly ShopStep[]): ShopStep | null {
  return steps.find((step) => step.status === "doing") ?? steps.find((step) => step.status !== "done") ?? null;
}

export function stepProgress(steps: readonly ShopStep[]): { done: number; total: number } {
  return { done: steps.filter((step) => step.status === "done").length, total: steps.length };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The part a scan points at. A drawing QR holds /manufacturing/part/<id>; a USB
 * scanner at the kiosk types that address (or just the id) followed by Enter.
 */
export function partIdFromScan(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fromPath = /\/manufacturing\/part\/([0-9a-f-]{36})/i.exec(trimmed);
  if (fromPath) return fromPath[1]!.toLowerCase();
  const bare = UUID.exec(trimmed);
  return bare && bare[0].length === trimmed.length ? bare[0].toLowerCase() : null;
}

/** Address the part QR holds (relative; the page adds the origin when it draws the code). */
export function partStepsPath(orgId: string, partId: string): string {
  return `/manufacturing/part/${partId}?${new URLSearchParams({ orgId })}`;
}

/** Starting work on a step puts a queued part on the machine. Other states are left alone. */
export function stateAfterStepStart(state: ManufacturingState): ManufacturingState | null {
  return state === "ready_to_cut" || state === "needs_finishing" ? "in_progress" : null;
}

/** When the last step is done, a part that was being made is done. */
export function stateAfterAllStepsDone(state: ManufacturingState): ManufacturingState | null {
  return state === "in_progress" || state === "needs_finishing" ? "done" : null;
}

/** Reopening a step on a finished part sends it back to finishing (the board's own reopen path). */
export function stateAfterStepReopened(state: ManufacturingState): ManufacturingState | null {
  return state === "done" ? "needs_finishing" : null;
}

/** Open parts the shop kiosk shows: anything on its way through the shop. */
export const KIOSK_STATES: readonly ManufacturingState[] = ["needs_cam", "ready_to_cut", "in_progress", "needs_finishing"];

/** Kiosk order: parts on a machine first, then the queue, earliest needed-by first. */
export function sortForKiosk(parts: readonly ShopPart[]): ShopPart[] {
  const rank = (state: ManufacturingState) => {
    const index = ["in_progress", "needs_finishing", "ready_to_cut", "needs_cam"].indexOf(state);
    return index < 0 ? 9 : index;
  };
  return [...parts].sort(
    (a, b) =>
      rank(a.state) - rank(b.state) ||
      (a.neededBy ?? "9999").localeCompare(b.neededBy ?? "9999") ||
      a.partName.localeCompare(b.partName),
  );
}
