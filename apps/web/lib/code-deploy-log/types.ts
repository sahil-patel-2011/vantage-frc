// Robot code deploy log domain types. Pure data shapes — no I/O, no framework imports.
// Distinct from the code-perf surface (which correlates logged code CHANGES against match
// performance deltas): this tracks the literal deploy record — what firmware/build ran, when,
// and against which match — the "what was running during qm42" answer.

export type DeployType = "practice" | "qualification" | "elimination" | "pit_test" | "other";

export type DeployStatus = "deployed" | "rolled_back" | "failed";

export type CodeDeployLogEntry = {
  id: string;
  seasonYear: number;
  /** ISO date (YYYY-MM-DD). */
  deployedOn: string;
  /** TBA-style match key this deploy ran during, if known (e.g. "2026miket_qm10"). */
  matchKey: string | null;
  eventKey: string | null;
  firmwareVersion: string;
  commitSha: string | null;
  branch: string | null;
  deployType: DeployType;
  status: DeployStatus;
  notes: string | null;
  createdAt: string;
};

export type CodeDeployLogSummary = {
  totalDeploys: number;
  matchLinkedDeploys: number;
  byStatus: Array<{ status: DeployStatus; count: number }>;
  byType: Array<{ deployType: DeployType; count: number }>;
  lastDeployedOn: string | null;
  rollbackRate: number;
};
