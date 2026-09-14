// Pure, framework-free reuse-vs-avoid math. Everything here is deterministic and grounded only
// in the FMEA failure history and design-review track record the caller supplies for a
// subsystem — it never fabricates a value. compute-reuse-advisor.ts wraps this with DB I/O; the
// API route and client render results.

import type {
  ReuseAssessInput,
  ReuseAssessResult,
  ReuseAssessmentStatus,
  ReuseRecommendation,
  SubsystemCategory,
} from "./types";

/** FMEA severity (1-10) at/above this is treated as a serious failure mode. */
export const HIGH_SEVERITY_THRESHOLD = 7;
/** Prior FMEA failures on this subsystem at/above this count are treated as a chronic issue. */
export const CHRONIC_FAILURE_COUNT = 3;
/** Design-review pass rate below this is treated as a shaky track record. */
export const MIN_DESIGN_REVIEW_PASS_RATE = 0.6;

export const REUSE_RECOMMENDATIONS: ReuseRecommendation[] = ["reuse", "modify", "avoid"];
export const REUSE_ASSESSMENT_STATUSES: ReuseAssessmentStatus[] = ["open", "accepted", "dismissed"];
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function reuseRecommendationLabel(recommendation: ReuseRecommendation): string {
  switch (recommendation) {
    case "reuse":
      return "Reuse as-is";
    case "avoid":
      return "Avoid — redesign";
    default:
      return "Reuse with changes";
  }
}

export function subsystemCategoryLabel(category: SubsystemCategory): string {
  if (category === "other") return "Other";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Core recommendation: reuse the prior-season subsystem, modify it, or avoid it entirely. */
export function assessReuse(input: ReuseAssessInput): ReuseAssessResult {
  const failures = Math.max(0, Math.round(input.fmeaFailureCount));
  const highSeverity = Math.max(0, Math.round(input.fmeaHighSeverityCount));
  const reviews = Math.max(0, Math.round(input.designReviewCount));
  const passes = Math.min(reviews, Math.max(0, Math.round(input.designReviewPassCount)));
  const passRate = reviews > 0 ? passes / reviews : null;

  const chronic = failures >= CHRONIC_FAILURE_COUNT;
  const hasHighSeverity = highSeverity >= 1;
  const weakReviewRecord = passRate !== null && passRate < MIN_DESIGN_REVIEW_PASS_RATE;

  if (chronic && hasHighSeverity) {
    return {
      recommendation: "avoid",
      confidence: round(clamp01(0.65 + Math.min(0.25, (failures - CHRONIC_FAILURE_COUNT) * 0.05))),
      rationale: `${failures} prior logged failure(s), including ${highSeverity} high-severity (>= ${HIGH_SEVERITY_THRESHOLD}/10) — a recurring, serious failure mode. Avoid reusing this design; start a redesign.`,
    };
  }

  if (failures === 0 && (passRate === null || passRate >= MIN_DESIGN_REVIEW_PASS_RATE)) {
    const reviewBonus = passRate !== null ? Math.min(0.2, passRate * 0.2) : 0;
    return {
      recommendation: "reuse",
      confidence: round(clamp01(0.6 + reviewBonus)),
      rationale:
        reviews > 0
          ? `No failures logged, and it passed ${passes}/${reviews} design review(s). Safe to reuse as-is.`
          : "No failures logged against this subsystem in prior seasons. Safe to reuse as-is.",
    };
  }

  if (hasHighSeverity || chronic || weakReviewRecord) {
    const confidence = round(
      clamp01(0.45 + (chronic ? 0.1 : 0) + (hasHighSeverity ? 0.1 : 0) + (weakReviewRecord ? 0.1 : 0)),
    );
    const parts: string[] = [];
    if (failures > 0) parts.push(`${failures} prior logged failure(s)`);
    if (hasHighSeverity) parts.push(`${highSeverity} high-severity`);
    if (reviews > 0) parts.push(`${passes}/${reviews} design review(s) passed`);
    return {
      recommendation: "modify",
      confidence,
      rationale: `${parts.join(", ")} — reusable, but address the known failure mode(s) before committing.`,
    };
  }

  return {
    recommendation: "modify",
    confidence: 0.5,
    rationale: `${failures} minor prior failure(s) logged, no high-severity or chronic pattern — reuse the core design with targeted fixes.`,
  };
}
