// EPA trend alerts domain types. Pure data shapes — no I/O, no framework imports.
// Watches opponent/scouted teams and surfaces meaningful EPA (Expected Points Added) swings
// computed from the shared TBA/Statbotics reference cache (team_event_metrics).

export type EpaTrendDirection = "up" | "down";

export type EpaTrendSeverity = "medium" | "high";

export type WatchlistTeam = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  note: string | null;
  createdAt: string;
};

export type EpaTrendPoint = {
  eventKey: string;
  eventName: string | null;
  startDate: string | null;
  epaTotal: number;
};

export type EpaTrendAlert = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  direction: EpaTrendDirection;
  /** Absolute EPA-point delta between the two most recent events with data. */
  magnitude: number;
  /** Fractional change relative to the prior event's EPA (can be negative). */
  percentChange: number;
  previousEpa: number;
  latestEpa: number;
  previousEventKey: string;
  latestEventKey: string;
  previousEventName: string | null;
  latestEventName: string | null;
  /** Stable id for dismiss/ack — changes only when a newer event supersedes it. */
  fingerprint: string;
  severity: EpaTrendSeverity;
};

export type EpaTrendSummary = {
  watchlistCount: number;
  alertCount: number;
  risingCount: number;
  fallingCount: number;
  highSeverityCount: number;
};
