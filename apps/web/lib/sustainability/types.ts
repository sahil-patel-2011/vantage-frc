// Sustainability early-warning domain types. Pure data shapes — no I/O.
//
// Evidence (docs/archive/COMMUNITY_DEMAND_RND.md): "~50% of dead rookie teams had exactly one sponsor
// vs a median of 3-4 for survivors; teams most commonly die 2 years after rookie season, when
// rookie grants expire." Teams are on a statistically documented death track and nobody tells
// them while there is still time to act.

export type SustainabilityLevel = "stable" | "watch" | "at-risk" | "unknown";

export type SustainabilityFactorKey =
  | "sponsor_concentration"
  | "funding_source_count"
  | "expiring_grant"
  | "funding_delta"
  | "roster_size"
  | "mentor_count";

export type SustainabilityFactor = {
  key: SustainabilityFactorKey;
  /** How much this factor moves the level. `neutral` factors are reassurance, not filler. */
  severity: "critical" | "warning" | "neutral";
  /** Headline a mentor reads first. Always contains the number it came from. */
  headline: string;
  /** The literal figure(s) behind the headline — the citation, never a vibe. */
  evidence: string;
  /** The one thing to do about it. */
  nextAction: string;
  /** Where that action happens. */
  href?: string;
};

/**
 * REAL rows only. Every field is nullable and `null` means NOT RECORDED — the assessment
 * degrades to `unknown` with a to-record list rather than inventing a scary score.
 */
export type SustainabilitySignals = {
  seasonYear: number;
  /** Every recorded funding source for the season, largest-first order not required. */
  fundingSources: Array<{
    id: string;
    name: string;
    kind: string;
    receivedUsd: number;
  }>;
  /** Total received across `fundingSources`, recomputed rather than trusted. */
  priorSeasonTotalUsd: number | null;
  /** Grants whose close/expiry falls inside the lookahead window and that have no successor. */
  expiringGrants: Array<{
    id: string;
    name: string;
    amountUsd: number | null;
    endsOn: string;
    daysUntilEnd: number;
    replaced: boolean;
  }>;
  /** Distinct prospects currently in the sponsor pipeline (not yet closed). */
  pipelineProspectCount: number | null;
  studentCount: number | null;
  mentorCount: number | null;
};

export type SustainabilityAssessment = {
  level: SustainabilityLevel;
  factors: SustainabilityFactor[];
  /** Present when `level === "unknown"`: exactly what to record to get an answer. */
  missingInputs: string[];
  /** Totals echoed back so the UI never recomputes money independently of the model. */
  totals: {
    fundingSourceCount: number;
    totalReceivedUsd: number;
    largestSourceName: string | null;
    largestSourceUsd: number | null;
    largestSourceSharePct: number | null;
  };
};
