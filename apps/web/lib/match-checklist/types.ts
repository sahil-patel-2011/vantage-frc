// Pre-match checklist domain types. Pure data shapes — no I/O, no framework imports.
// One-tap timed checklist per match: bumper, battery, tether, code (default items),
// each tap records the time it was checked so pit crews can see how fast the team is ready.

export type ChecklistItemKey =
  | "bumper"
  | "battery"
  | "tether"
  | "code"
  | "sb50"
  | "ds_power"
  | "ds_ethernet"
  | "ds_estop";

export type ChecklistItem = {
  key: ChecklistItemKey;
  label: string;
  done: boolean;
  /** ISO timestamp of when the item was last marked done, or null if not done. */
  checkedAt: string | null;
};

export type BumperColor = "red" | "blue";

export type MatchChecklistRun = {
  id: string;
  matchLabel: string;
  eventKey: string | null;
  teamNumber: number | null;
  startedAt: string;
  completedAt: string | null;
  items: ChecklistItem[];
  /** Seconds between startedAt and completedAt (or now, if still open), or null if not started. */
  elapsedSeconds: number | null;
  allDone: boolean;
  /** TBA alliance color for this team — null when the schedule cache has no row. */
  bumperColor: BumperColor | null;
};

/** Upcoming TBA match the pit can hang bumpers for — never invented. */
export type UpcomingBumperMatch = {
  matchKey: string;
  eventKey: string;
  label: string;
  bumperColor: BumperColor;
};

export type MatchChecklistSummary = {
  totalRuns: number;
  completedRuns: number;
  openRuns: number;
  /** Average seconds-to-complete across completed runs, or null if none completed yet. */
  averageElapsedSeconds: number | null;
  fastestElapsedSeconds: number | null;
};
