// Cross-season subsystem reuse advisor domain types. Pure data shapes — no I/O, no framework
// imports. A "candidate" is a prior-season subsystem (from robot_subsystems) cross-referenced
// against its FMEA failure history (fmea_failures) and design-review track record
// (design_reviews), all matched by subsystem name. A "recommendation" is the deterministic
// reuse/modify/avoid call for that candidate. An "assessment" is a persisted recommendation the
// team recorded against the season they are currently designing.

export type SubsystemCategory =
  | "drivetrain"
  | "intake"
  | "shooter"
  | "arm"
  | "elevator"
  | "climber"
  | "turret"
  | "indexer"
  | "other";

export type ReuseRecommendation = "reuse" | "modify" | "avoid";

export type ReuseAssessmentStatus = "open" | "accepted" | "dismissed";

/** Inputs the deterministic recommendation is grounded in — nothing else. */
export type ReuseAssessInput = {
  fmeaFailureCount: number;
  fmeaHighSeverityCount: number;
  designReviewCount: number;
  designReviewPassCount: number;
};

/** Deterministic reuse-vs-avoid recommendation, grounded only in the supplied history counts. */
export type ReuseAssessResult = {
  recommendation: ReuseRecommendation;
  confidence: number;
  rationale: string;
};

/** A prior-season subsystem candidate for reuse, joined with its FMEA + design-review history. */
export type ReuseCandidate = {
  subsystemId: string;
  subsystemName: string;
  category: SubsystemCategory;
  sourceSeasonYear: number;
  motorType: string;
  motorCount: number | null;
  fmeaFailureCount: number;
  fmeaHighSeverityCount: number;
  designReviewCount: number;
  designReviewPassCount: number;
  recommendation: ReuseRecommendation;
  confidence: number;
  rationale: string;
  alreadyAssessed: boolean;
};

/** A persisted reuse assessment recorded against the season currently being designed. */
export type ReuseAssessment = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  category: SubsystemCategory;
  sourceSubsystemId: string | null;
  sourceSeasonYear: number | null;
  fmeaFailureCount: number;
  fmeaHighSeverityCount: number;
  designReviewCount: number;
  designReviewPassCount: number;
  recommendation: ReuseRecommendation;
  confidence: number;
  rationale: string;
  status: ReuseAssessmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
