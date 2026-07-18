// Event-day stress planner domain types. Pure data shapes — no I/O, no framework imports.
// A per-hour plan overlaying qual schedule, battery needs, scout shifts, pit-repair windows,
// and logistics tasks for a single competition day, with conflict detection over the record
// actually logged (never fabricated).

export type EventDayPlanKind =
  | "qual_match"
  | "battery_charge"
  | "scout_shift"
  | "pit_repair"
  | "logistics"
  | "other";

export type EventDayPlanStatus = "planned" | "in_progress" | "done" | "cancelled";

export type EventDayPlanBlock = {
  id: string;
  eventKey: string;
  planDate: string;
  kind: EventDayPlanKind;
  title: string;
  /** ISO timestamp. */
  startAt: string;
  /** ISO timestamp. */
  endAt: string;
  assignedTo: string | null;
  location: string | null;
  notes: string | null;
  status: EventDayPlanStatus;
};

export type EventDayPlanConflict = {
  id: string;
  reason: "assignee_overlap" | "location_overlap";
  blockAId: string;
  blockBId: string;
  detail: string;
};

export type EventDayPlanHourSlot = {
  /** Hour-of-day, 0-23, in the plan date's local overlay. */
  hour: number;
  blocks: EventDayPlanBlock[];
};

export type EventDayPlanSummary = {
  totalBlocks: number;
  byKind: Array<{ kind: EventDayPlanKind; count: number }>;
  conflictCount: number;
  unassignedCount: number;
};
