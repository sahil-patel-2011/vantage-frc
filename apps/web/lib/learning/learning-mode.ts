// Learning mode — the single decision function behind "Call Your Shot".
//
// Vantage never hands a student an answer they have not first called: on the
// engineering calculators the computed output renders as a prediction input
// until the student commits a guess. Mentors are NEVER gated — they came to get
// a number, not a lesson. And the gate is always skippable: a robot at 11pm on
// week six beats a lesson, so "Just show me" always exists and is recorded as a
// skip rather than blocked.
//
// Pure module: no DB, no React, no I/O. Everything here is decided from the
// viewer's org role plus their own toggle.

/** Roles come from the org_role enum (0000_foundation.sql). */
export type OrgRole = "owner" | "admin" | "scout" | "viewer";

/** Mentor tier: owners and admins run the team. Never gated. */
export const MENTOR_ROLES: readonly OrgRole[] = ["owner", "admin"];
/** Student tier: scouts and viewers are the people we are teaching. */
export const STUDENT_ROLES: readonly OrgRole[] = ["scout", "viewer"];

export type LearningTier = "mentor" | "student";

/** Surfaces that currently gate a computed result behind a prediction. */
export const LEARNING_SURFACES = ["gearbox", "power_budget", "shooter_table"] as const;
export type LearningSurface = (typeof LEARNING_SURFACES)[number];

const SURFACE_LABELS: Record<LearningSurface, string> = {
  gearbox: "Gearbox ratio",
  power_budget: "Power budget",
  shooter_table: "Shooter table",
};

export function isLearningSurface(value: unknown): value is LearningSurface {
  return typeof value === "string" && (LEARNING_SURFACES as readonly string[]).includes(value);
}

export function parseLearningSurface(value: unknown): LearningSurface {
  if (!isLearningSurface(value)) {
    throw new Error(`surface must be one of ${LEARNING_SURFACES.join(", ")}`);
  }
  return value;
}

export function learningSurfaceLabel(surface: LearningSurface): string {
  return SURFACE_LABELS[surface];
}

/**
 * Unknown roles are treated as student tier. Failing toward "teach" is safe
 * (the gate is skippable); failing toward "mentor" would silently disable the
 * whole feature for anyone whose role string we do not recognise.
 */
export function roleTier(role: string | null | undefined): LearningTier {
  return role && (MENTOR_ROLES as readonly string[]).includes(role) ? "mentor" : "student";
}

/** Learning mode is ON by default for students, OFF for mentors. */
export function defaultLearningModeEnabled(role: string | null | undefined): boolean {
  return roleTier(role) === "student";
}

/**
 * Resolve the effective learning-mode flag: an explicit user choice wins, and
 * absent a choice the role decides. Mentors who deliberately switch it on get
 * it (useful for a mentor demoing the lesson) — the gate still never blocks.
 */
export function resolveLearningModeEnabled(
  role: string | null | undefined,
  stored: boolean | null | undefined,
): boolean {
  return typeof stored === "boolean" ? stored : defaultLearningModeEnabled(role);
}

export type GateInput = {
  role: string | null | undefined;
  /** The viewer's resolved learning-mode toggle. Omit to use the role default. */
  learningModeEnabled?: boolean | null;
  /** True once this viewer has committed (or skipped) a call for these inputs. */
  alreadyAnswered?: boolean;
};

export type GateDecision = {
  /** When true the computed result is withheld until a prediction is committed. */
  gated: boolean;
  tier: LearningTier;
  reason: "mentor_never_gated" | "learning_mode_off" | "already_answered" | "call_required";
  /**
   * Always true. A gate that cannot be skipped is a blocker, and a blocker at
   * 11pm in week six is how a teaching feature gets ripped out of a product.
   */
  skippable: true;
  /** Copy for the visible escape hatch. */
  skipLabel: string;
};

export function shouldGateResult(input: GateInput): GateDecision {
  const tier = roleTier(input.role);
  const enabled = resolveLearningModeEnabled(input.role, input.learningModeEnabled);
  const base = { tier, skippable: true as const, skipLabel: "Just show me" };

  if (tier === "mentor" && input.learningModeEnabled !== true) {
    return { ...base, gated: false, reason: "mentor_never_gated" };
  }
  if (!enabled) return { ...base, gated: false, reason: "learning_mode_off" };
  if (input.alreadyAnswered) return { ...base, gated: false, reason: "already_answered" };
  return { ...base, gated: true, reason: "call_required" };
}

/** Mentors (and only mentors) may read the whole org's calls to see who is struggling. */
export function canReadOrgCalls(role: string | null | undefined): boolean {
  return roleTier(role) === "mentor";
}
