// Autonomous path library domain types. Pure data shapes — no I/O, no framework imports.
// Tracks named autonomous paths (starting position, description, notes) and the individual
// runs logged against each path (success/fail + context), so a per-path success rate can be
// computed from real run history instead of a single subjective "works/doesn't work" flag.

export type AutonPathStartPosition = "left" | "center" | "right" | "other";

export type AutonPath = {
  id: string;
  name: string;
  startPosition: AutonPathStartPosition;
  description: string | null;
  gamePieces: number;
  seasonYear: number;
  active: boolean;
  createdAt: string;
};

export type AutonPathRunOutcome = "success" | "partial" | "fail";

export type AutonPathRun = {
  id: string;
  pathId: string;
  outcome: AutonPathRunOutcome;
  occurredOn: string;
  eventLabel: string | null;
  matchLabel: string | null;
  notes: string | null;
  loggedBy: string;
  createdAt: string;
};

export type AutonPathStats = {
  pathId: string;
  totalRuns: number;
  successRuns: number;
  partialRuns: number;
  failRuns: number;
  /** 0..1 — successRuns / totalRuns. Null when there is no run history yet. */
  successRate: number | null;
  lastRunOn: string | null;
};

export type AutonPathWithStats = AutonPath & { stats: AutonPathStats };

export type AutonPathLibrarySummary = {
  totalPaths: number;
  activePaths: number;
  totalRuns: number;
  /** 0..1 — blended success rate across all paths with at least one run. Null when no runs exist. */
  overallSuccessRate: number | null;
  bestPathId: string | null;
};
