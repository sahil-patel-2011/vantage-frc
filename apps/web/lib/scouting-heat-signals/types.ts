// Scouting Heat Signals domain types. Pure data shapes — no I/O, no framework imports.
// Captures scouts' own trend read on teams they've observed (climbing / falling off / steady)
// to inform alliance-selection pick strategy. Distinct from epa-trend-alerts, which watches
// TBA/Statbotics EPA swings rather than scouts' first-hand observations.

export type HeatDirection = "up" | "down" | "steady";

export type HeatSignalEntry = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  /** ISO date (YYYY-MM-DD) the observation was made. */
  observedOn: string;
  direction: HeatDirection;
  /** Optional numeric read (e.g. a scored metric) backing the direction call. */
  metricValue: number | null;
  note: string | null;
  matchKey: string | null;
  loggedBy: string;
  createdAt: string;
};

export type TeamHeatSignal = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  /** -1..1 recency-weighted heat score; positive = trending up. */
  heatScore: number;
  direction: HeatDirection;
  entryCount: number;
  risingCount: number;
  fallingCount: number;
  steadyCount: number;
  lastObservedOn: string;
  /** Delta between the most recent and earliest recorded metricValue, when at least two exist. */
  metricDelta: number | null;
  recentEntries: HeatSignalEntry[];
};

export type HeatSignalSummary = {
  totalTeams: number;
  totalEntries: number;
  risingTeams: number;
  fallingTeams: number;
  steadyTeams: number;
};
