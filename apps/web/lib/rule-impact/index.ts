// Pure, framework-free rule-impact math. Everything here is deterministic and grounded only in
// the matched-rule counts the caller supplies for a subsystem — it never fabricates a value.
// compute-rule-impact.ts wraps this with DB I/O; the API route and client render results.

import type {
  RuleChangeCategory,
  RuleChangeSeverity,
  RuleImpactAssessInput,
  RuleImpactAssessResult,
  RuleImpactAssessmentStatus,
  RuleImpactStatus,
  SubsystemCategory,
} from "./types";

export const RULE_IMPACT_STATUSES: RuleImpactStatus[] = ["still_legal", "needs_rework", "blocked"];
export const RULE_IMPACT_ASSESSMENT_STATUSES: RuleImpactAssessmentStatus[] = ["open", "accepted", "dismissed"];
export const RULE_CHANGE_CATEGORIES: RuleChangeCategory[] = [
  "dimension",
  "weight",
  "material",
  "mechanism",
  "motor_limit",
  "safety",
  "scoring",
  "other",
];
export const RULE_CHANGE_SEVERITIES: RuleChangeSeverity[] = ["minor", "major", "blocking"];
export const SUBSYSTEM_CATEGORIES: SubsystemCategory[] = [
  "drivetrain",
  "intake",
  "shooter",
  "arm",
  "elevator",
  "climber",
  "turret",
  "indexer",
  "other",
];

/** 3+ matched rule changes (even minor) on one subsystem is treated as a broad-reaching diff. */
export const BROAD_MATCH_COUNT = 3;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function ruleImpactStatusLabel(status: RuleImpactStatus): string {
  switch (status) {
    case "still_legal":
      return "Still legal";
    case "blocked":
      return "Blocked — redesign required";
    default:
      return "Needs rework";
  }
}

export function subsystemCategoryLabel(category: SubsystemCategory): string {
  if (category === "other") return "Other";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function ruleChangeCategoryLabel(category: RuleChangeCategory): string {
  switch (category) {
    case "motor_limit":
      return "Motor limit";
    default:
      return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

export function ruleChangeSeverityLabel(severity: RuleChangeSeverity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

/** Core impact call: is this prior-season subsystem still legal, needs rework, or is it blocked. */
export function assessRuleImpact(input: RuleImpactAssessInput): RuleImpactAssessResult {
  const matched = Math.max(0, Math.round(input.matchedRuleCount));
  const blocking = Math.min(matched, Math.max(0, Math.round(input.blockingRuleCount)));
  const major = Math.min(matched, Math.max(0, Math.round(input.majorRuleCount)));

  if (blocking >= 1) {
    return {
      status: "blocked",
      confidence: round(clamp01(0.7 + Math.min(0.25, (blocking - 1) * 0.1))),
      rationale: `${blocking} blocking rule change(s) apply to this subsystem's category — the prior design is no longer legal. Redesign is required before reuse.`,
    };
  }

  if (matched === 0) {
    return {
      status: "still_legal",
      confidence: 0.9,
      rationale: "No logged rule changes target this subsystem's category — the prior-season design remains legal as-is.",
    };
  }

  if (major >= 1 || matched >= BROAD_MATCH_COUNT) {
    return {
      status: "needs_rework",
      confidence: round(clamp01(0.55 + (major >= 1 ? 0.15 : 0) + Math.min(0.15, (matched - 1) * 0.05))),
      rationale: `${matched} rule change(s) apply, including ${major} major — verify dimensions/limits and rework the affected areas before reuse.`,
    };
  }

  return {
    status: "needs_rework",
    confidence: round(clamp01(0.45 + matched * 0.05)),
    rationale: `${matched} minor rule change(s) apply to this subsystem's category — spot-check compliance, but the core design is likely reusable.`,
  };
}
