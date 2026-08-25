// Part Manufacturing kanban — shared types. Pure data shapes only, no I/O.

export type ManufacturingState =
  | "needs_design"
  | "needs_cam"
  | "ready_to_cut"
  | "in_progress"
  | "needs_finishing"
  | "done"
  | "scrapped";

export type ManufacturingMethod =
  | "mill"
  | "lathe"
  | "router"
  | "waterjet"
  | "laser"
  | "3d_print"
  | "bandsaw"
  | "sheet_bend"
  | "cots"
  | "assembly"
  | "other";

export type ManufacturingPriority = "low" | "normal" | "high" | "critical";

export type ManufacturingPart = {
  id: string;
  seasonYear: number;
  partName: string;
  quantity: number;
  method: ManufacturingMethod;
  state: ManufacturingState;
  priority: ManufacturingPriority;
  subsystemId: string | null;
  subsystemName: string | null;
  bomEntryId: string | null;
  inventoryItemId: string | null;
  buildTaskId: string | null;
  material: string | null;
  stockNote: string | null;
  neededBy: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  requestedBy: string;
  scrapReason: string | null;
  reprintOfId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManufacturingStateEvent = {
  id: string;
  partId: string;
  fromState: ManufacturingState | null;
  toState: ManufacturingState;
  note: string | null;
  createdAt: string;
};

export type SubsystemOption = {
  id: string;
  name: string;
  seasonYear: number;
};

export type BomSeedOption = {
  id: string;
  subsystem: string;
  itemName: string;
  partNumber: string | null;
  quantityNeeded: number;
  alreadySeeded: boolean;
};

export type MemberOption = {
  userId: string;
  name: string;
};

/** Per-state average dwell hours; null until enough parts have actually finished. */
export type CycleTimeSummary = {
  completedParts: number;
  byState: { state: ManufacturingState; avgHours: number }[];
} | null;

export type SubsystemCoverageRow = {
  subsystemId: string | null;
  subsystemName: string;
  total: number;
  done: number;
  active: number;
};
