// Opponent Watchlist domain types. Pure data shapes — no I/O, no framework imports.
// Personal per-member watchlist of opponent teams; surfaces EPA and schedule changes for teams
// a member is tracking ahead of/during an event. Distinct from `epa-trend-alerts`, which is an
// org-shared watchlist scoped to a single event's EPA swings — this is a personal cross-event
// tracker that also watches for schedule (next-match) changes.

export type WatchlistAlertType = "epa_up" | "epa_down" | "schedule_new" | "schedule_changed";

export type WatchlistCurrentMetrics = {
  eventKey: string;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  rank: number | null;
};

export type WatchlistNextMatch = {
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
};

export type WatchlistEntry = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  note: string | null;
  notifySchedule: boolean;
  notifyEpa: boolean;
  createdAt: string;
  current: WatchlistCurrentMetrics | null;
  nextMatch: WatchlistNextMatch | null;
};

export type WatchlistAlert = {
  entryId: string;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  type: WatchlistAlertType;
  message: string;
  previousValue: string | null;
  currentValue: string | null;
  detectedAt: string;
};

export type WatchlistSummary = {
  totalWatched: number;
  epaAlerts: number;
  scheduleAlerts: number;
  upcomingMatches: number;
};
