// Scout Coverage Live domain types. Pure data shapes — no I/O, no framework imports.
// Tracks, per active event, which match/team assignments have zero or thin scouting coverage
// and the nudges sent to the scout coordinator to close those gaps mid-event.

export type CoverageStatus = "zero" | "thin" | "covered";

export type Alliance = "red" | "blue";

export type CoverageCell = {
  matchKey: string;
  matchLabel: string;
  compLevel: string;
  matchNumber: number;
  teamKey: string;
  teamNumber: number;
  alliance: Alliance;
  entryCount: number;
  status: CoverageStatus;
};

export type CoverageSummary = {
  totalCells: number;
  zeroCount: number;
  thinCount: number;
  coveredCount: number;
  /** Fraction (0..1) of cells that are at least "covered" (not zero, not thin). */
  coveragePct: number;
};

export type CoverageNudge = {
  id: string;
  matchKey: string;
  matchLabel: string;
  teamKey: string;
  teamNumber: number;
  message: string;
  sentBy: string;
  sentAt: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
};
