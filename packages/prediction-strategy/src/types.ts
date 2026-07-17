export type Alliance = "red" | "blue";

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
  researchConfidence?: number;
  researchAdjustment?: number;
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
};

export type PredictionFactor = {
  name: string;
  alliance: Alliance | "neutral";
  impact: number;
  evidence: string;
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
};
