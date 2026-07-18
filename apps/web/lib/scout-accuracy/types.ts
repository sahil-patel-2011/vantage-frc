// Scout accuracy domain types. Pure data shapes — no I/O, no framework imports.
// Scores each scout's logged match entries against the cached TBA `score_breakdown`
// (alliance-level official scoring on matches_ref) and rolls the per-entry errors up into a
// ranked per-scout leaderboard, used to suggest promoting the most reliable scouts into the
// pick-desk rotation.

/** Comparable numeric fields present in a scout payload and a TBA score_breakdown alliance. */
export type ScoutAccuracyFieldKey = "autoPoints" | "teleopPoints" | "endgamePoints" | "totalPoints";

export type ScoutAccuracyAlliance = "red" | "blue";

/** Per-entry outcome: the scout's totalPoints estimate checked against the alliance's actual total. */
export type ScoutAccuracyEntry = {
  matchScoutEntryId: string;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  teamNumber: number | null;
  scoutUserId: string;
  scoutName: string;
  allianceColor: ScoutAccuracyAlliance | null;
  scoutValue: number | null;
  officialValue: number | null;
  /** Absolute error as a fraction of the official value (0 = perfect). Null when unverifiable. */
  absErrorPct: number | null;
  /** Within tolerance of the official value. */
  accurate: boolean;
  verifiable: boolean;
};

export type ScoutAccuracyTier = "lead" | "core" | "developing" | "unverified";

export type ScoutAccuracyScoutStat = {
  scoutUserId: string;
  scoutName: string;
  entriesScored: number;
  verifiableEntries: number;
  accurateEntries: number;
  /** 0..1 accurate/verifiable rate. */
  accuracyRate: number;
  /** Mean absolute error percent across verifiable entries (0 = perfect). Null with no verifiable data. */
  avgAbsErrorPct: number | null;
  /** 0..100 blended accuracy score, higher is better. */
  accuracyScore: number;
  rank: number;
  tier: ScoutAccuracyTier;
  /** True when this scout clears the pick-desk rotation threshold. */
  suggestedPromote: boolean;
  /** True when a coach has confirmed the promotion (persisted override). */
  promoted: boolean;
};

export type ScoutAccuracySummary = {
  totalEntries: number;
  verifiableEntries: number;
  totalScouts: number;
  avgAccuracyScore: number;
  suggestedPromotions: number;
};

export type ScoutAccuracySnapshotMeta = {
  id: string;
  eventKey: string;
  seasonYear: number;
  entriesScored: number;
  scoutsScored: number;
  avgAccuracyScore: number;
  computedAt: string;
};
