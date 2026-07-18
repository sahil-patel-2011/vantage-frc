// Live match-delta watcher domain types. Pure data shapes — no I/O, no framework imports.
// Watches official match results as they land (via matches_ref + predictions, both populated by
// the reference/prediction pipelines) and flags when reality diverges from our prediction model
// or our pick-list priorities — e.g. a confident predicted winner loses, or a top pick-list team
// is on the losing alliance. Distinct from `predictions` (the forecast itself): this is the
// divergence/alerting layer on top of it.

export type MatchDeltaAlliance = "red" | "blue" | "tie";

export type MatchDeltaAlertType = "winner_mismatch" | "pick_list_upset" | "margin_surprise";

export type MatchDeltaSeverity = "info" | "watch" | "critical";

export type MatchDeltaAlert = {
  id: string;
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  alertType: MatchDeltaAlertType;
  severity: MatchDeltaSeverity;
  predictedWinner: MatchDeltaAlliance | null;
  actualWinner: MatchDeltaAlliance | null;
  predictedProbability: number | null;
  summary: string;
  teamsInvolved: string[];
  acknowledged: boolean;
  createdAt: string;
};

export type MatchDeltaConfig = {
  id: string;
  eventKey: string;
  enabled: boolean;
  /** 0.5..1 — confidence above which a missed winner call is treated as "critical" rather than "watch". */
  upsetThreshold: number;
  createdAt: string;
  updatedAt: string;
};

export type MatchDeltaSummary = {
  totalWatchedMatches: number;
  totalAlerts: number;
  criticalAlerts: number;
  unacknowledgedAlerts: number;
  /** 0..1 fraction of scored predictions whose predicted winner matched the actual winner. */
  accuracyRate: number;
};

/** Inputs needed to classify a single completed, predicted match into zero or more delta alerts. */
export type MatchDeltaClassificationInput = {
  predictedWinner: MatchDeltaAlliance;
  actualWinner: MatchDeltaAlliance;
  pRed: number;
  pBlue: number;
  redTeams: string[];
  blueTeams: string[];
  /** team_key -> pick-list rank (1 = top pick), for the org's most recent pick list at this event. */
  pickListRanks: Record<string, number> | null;
  upsetThreshold: number;
};

export type MatchDeltaClassification = {
  alertType: MatchDeltaAlertType;
  severity: MatchDeltaSeverity;
  summary: string;
  teamsInvolved: string[];
};
