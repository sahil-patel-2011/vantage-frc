// Live official cross-validation domain types. Pure data shapes — no I/O, no framework imports.
// Compares a match-scout entry's per-field values against the cached TBA `score_breakdown`
// (alliance-level official scoring) and produces an agree/conflict/unverifiable badge per field.

export type CrossvalStatus = "agree" | "conflict" | "unverifiable";

export type CrossvalAlliance = "red" | "blue";

/** Known comparable fields — alliance-level totals present in TBA's cached score_breakdown. */
export type CrossvalFieldKey = "autoPoints" | "teleopPoints" | "endgamePoints" | "totalPoints";

export type CrossvalFieldCheck = {
  fieldKey: CrossvalFieldKey;
  fieldLabel: string;
  scoutValue: number | null;
  officialValue: number | null;
  status: CrossvalStatus;
  deltaAbs: number | null;
  deltaPct: number | null;
};

export type CrossvalEntry = {
  id: string;
  matchScoutEntryId: string;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  teamNumber: number | null;
  scoutUserId: string;
  allianceColor: CrossvalAlliance | null;
  overallStatus: CrossvalStatus;
  agreeCount: number;
  conflictCount: number;
  unverifiableCount: number;
  fields: CrossvalFieldCheck[];
  computedAt: string;
};

export type CrossvalSummary = {
  totalEntries: number;
  agreeEntries: number;
  conflictEntries: number;
  unverifiableEntries: number;
  /** 0..1 agreement rate among entries that had at least one verifiable field. */
  agreementRate: number;
};
