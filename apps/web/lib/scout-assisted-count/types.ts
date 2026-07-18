// Scout-assisted count domain types. Pure data shapes — no I/O, no framework imports.
// A "session" is one tally-counter run (e.g. counting opponent cycles during a match); each
// tap increments a running total and is retained individually as a raw tap-log entry so the
// count can be audited or corrected after the fact.

export type CountSessionStatus = "open" | "closed";

export type CountTap = {
  id: string;
  sessionId: string;
  delta: number;
  tappedBy: string;
  tappedAt: string;
};

export type CountSession = {
  id: string;
  metricKey: string;
  matchKey: string | null;
  teamKey: string | null;
  label: string;
  status: CountSessionStatus;
  tapCount: number;
  startedBy: string;
  startedAt: string;
  closedAt: string | null;
  taps: CountTap[];
};

export type CountSummary = {
  totalSessions: number;
  openSessions: number;
  closedSessions: number;
  totalTaps: number;
  averageTapsPerSession: number;
};
