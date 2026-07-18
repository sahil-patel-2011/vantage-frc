// Rule-change impact analyzer domain types. Pure data shapes — no I/O, no framework imports. A
// "rule change" is a new-season game-manual delta the team logs at kickoff (rule_impact_rule_changes).
// A "candidate" is a prior-season subsystem (from robot_subsystems) cross-referenced against the
// rule changes that target its subsystem category. An "impact" is the deterministic
// still-legal/needs-rework/blocked call for that candidate. An "assessment" is a persisted impact
// call the team recorded against the season they are currently designing for.

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

export type RuleChangeCategory =
  | "dimension"
  | "weight"
  | "material"
  | "mechanism"
  | "motor_limit"
  | "safety"
  | "scoring"
  | "other";

export type RuleChangeSeverity = "minor" | "major" | "blocking";

export type RuleImpactStatus = "still_legal" | "needs_rework" | "blocked";

export type RuleImpactAssessmentStatus = "open" | "accepted" | "dismissed";

/** A logged new-season rule delta, optionally targeting a subsystem category. */
export type RuleChange = {
  id: string;
  seasonYear: number;
  ruleCode: string;
  title: string;
  category: RuleChangeCategory;
  severity: RuleChangeSeverity;
  subsystemCategory: SubsystemCategory | null;
  summary: string;
  sourceUrl: string | null;
  createdAt: string;
};

/** Inputs the deterministic impact call is grounded in — nothing else. */
export type RuleImpactAssessInput = {
  matchedRuleCount: number;
  blockingRuleCount: number;
  majorRuleCount: number;
};

/** Deterministic still-legal/needs-rework/blocked call, grounded only in the matched rule counts. */
export type RuleImpactAssessResult = {
  status: RuleImpactStatus;
  confidence: number;
  rationale: string;
};

/** A prior-season subsystem candidate, joined with the rule changes matching its category. */
export type RuleImpactCandidate = {
  subsystemId: string;
  subsystemName: string;
  category: SubsystemCategory;
  sourceSeasonYear: number;
  motorType: string;
  motorCount: number | null;
  matchedRuleCount: number;
  blockingRuleCount: number;
  majorRuleCount: number;
  matchedRules: Array<{ id: string; ruleCode: string; title: string; severity: RuleChangeSeverity }>;
  impactStatus: RuleImpactStatus;
  confidence: number;
  rationale: string;
  alreadyAssessed: boolean;
};

/** A persisted rule-impact assessment recorded against the season currently being designed. */
export type RuleImpactAssessment = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  category: SubsystemCategory;
  sourceSubsystemId: string | null;
  sourceSeasonYear: number | null;
  matchedRuleCount: number;
  blockingRuleCount: number;
  majorRuleCount: number;
  impactStatus: RuleImpactStatus;
  confidence: number;
  rationale: string;
  status: RuleImpactAssessmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
