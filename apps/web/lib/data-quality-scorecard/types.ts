// Data Quality Scorecard domain types. Pure data shapes — no I/O, no framework imports.
// A "check" is one logged quality review of a scouting record (match/pit entry a scout filed):
// how complete it was (coverage), whether a cross-check with another scout agreed (disagreement),
// and how far the value deviated from team consensus at the time (drift signal).

export type DataQualityCheck = {
  id: string;
  eventKey: string;
  matchKey: string | null;
  scoutName: string;
  checkDate: string;
  expectedDataPoints: number;
  capturedDataPoints: number;
  crossChecked: boolean;
  agreement: boolean | null;
  deviationScore: number | null;
  seasonYear: number;
  notes: string | null;
};

export type DataQualityByEvent = {
  eventKey: string;
  checks: number;
  coverage: number;
  disagreementRate: number;
  crossCheckedCount: number;
};

export type DataQualityByScout = {
  scoutName: string;
  checks: number;
  coverage: number;
  disagreementRate: number;
  avgDeviation: number | null;
};

export type DataQualityTrendPoint = {
  week: string;
  checks: number;
  coverage: number;
  avgDeviation: number | null;
};

export type DataQualityScorecardSummary = {
  totalChecks: number;
  coverage: number;
  disagreementRate: number;
  crossCheckedCount: number;
  driftScore: number | null;
  byEvent: DataQualityByEvent[];
  byScout: DataQualityByScout[];
  trend: DataQualityTrendPoint[];
};

export type DataQualityGrade = "excellent" | "solid" | "needs_attention" | "at_risk";

export type DataQualityScorecard = {
  score: number;
  grade: DataQualityGrade;
  components: {
    coverage: number;
    agreement: number;
    stability: number;
  };
  recommendations: string[];
};
