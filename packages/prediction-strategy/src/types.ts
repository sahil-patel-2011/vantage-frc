export type Alliance = "red" | "blue";

export type EvidenceKind = "model" | "fact";

export type TeamSeasonSignal = {
  teamKey: string;
  year: number;
  matches: number;
  epa: number;
  autoEpa?: number;
  endgameEpa?: number;
  /** Provenance label when available (e.g. tba, statbotics). */
  source?: string;
  eventKey?: string;
};

export type TeamOperationalSignal = {
  teamKey: string;
  scoutSample: number;
  reliability?: number;
  foulRate?: number;
  /** Mean scout-quality weight after anomaly/confidence downweighting (0–1). */
  qualityWeight?: number;
  /** 0–1 scout-derived auto capability. */
  autoCapability?: number;
  /** 0–1 scout-derived teleop capability. */
  teleopCapability?: number;
  /** 0–1 scout-derived endgame capability. */
  endgameCapability?: number;
  defenseLikely?: boolean;
  pitNotes?: string[];
  /** Entry ids that influenced this team's operational signal. */
  scoutEntryIds?: string[];
  /** Human-readable quality transparency lines. */
  qualityNotes?: string[];
  researchConfidence?: number;
  researchAdjustment?: number;
};

/** TBA-shaped completed (or scored) match row for FACT citations. */
export type MatchResultFact = {
  matchKey: string;
  winningAlliance: "red" | "blue" | null;
  red: string[];
  blue: string[];
  redScore?: number | null;
  blueScore?: number | null;
  eventKey?: string;
};

export type MatchPredictionInput = {
  matchKey: string;
  currentYear: number;
  red: string[];
  blue: string[];
  seasons: TeamSeasonSignal[];
  operations?: TeamOperationalSignal[];
  /** Human-readable event context for factor evidence (optional). */
  eventLabel?: string;
  /** Optional TBA-shaped match results for FACT citations. */
  matchResults?: MatchResultFact[];
};

export type PredictionFactor = {
  name: string;
  alliance: Alliance | "neutral";
  impact: number;
  evidence: string;
  /** MODEL = inference; FACT = TBA/schedule observation. */
  kind: EvidenceKind;
  /** Match/pit scout entry UUIDs that influenced this factor (when applicable). */
  scoutEntryIds?: string[];
};

export type MatchCitation = {
  matchKey: string;
  kind: "fact";
  summary: string;
  relatedTeamKeys: string[];
  winningAlliance: Alliance | null;
  redScore: number | null;
  blueScore: number | null;
};

export type TeamContribution = {
  teamKey: string;
  alliance: Alliance;
  rating: number;
  shareOfAlliance: number;
  shareOfMatch: number;
  contributionPts: number;
  /** Leave-one-out change in p(red) when this robot is removed. */
  deltaPRed: number;
  evidence: string;
  kind: "model";
};

export type AllianceWinBreakdown = {
  matchKey: string;
  modelVersion: "weighted-current-v1";
  pRed: number;
  pBlue: number;
  confidenceLow: number;
  confidenceHigh: number;
  effectiveSampleSize: number;
  red: TeamContribution[];
  blue: TeamContribution[];
  citations: MatchCitation[];
  keyFactors: PredictionFactor[];
  caveats: string[];
};

export type MatchPrediction = {
  matchKey: string;
  modelVersion: "weighted-current-v1";
  pRed: number;
  pBlue: number;
  confidenceLow: number;
  confidenceHigh: number;
  effectiveSampleSize: number;
  keyFactors: PredictionFactor[];
  caveats: string[];
  /** Present when matchResults were supplied or breakdown was attached. */
  citations?: MatchCitation[];
  /** Alliance 3v3 contribution breakdown (MODEL). */
  contributions?: {
    red: TeamContribution[];
    blue: TeamContribution[];
  };
};
