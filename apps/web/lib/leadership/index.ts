// Leadership Continuity rollups. Pure aggregation over role rows — deterministic given
// its input. Never fabricates a score: an empty roster yields 0 across the board.

import type {
  LeadershipCategory,
  LeadershipHandoffStatus,
  LeadershipReadiness,
  LeadershipRole,
  LeadershipSummary,
  LeadershipTier,
} from "./types";

export * from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export const LEADERSHIP_CATEGORIES: LeadershipCategory[] = [
  "leadership",
  "technical",
  "mentor",
  "business",
  "safety",
  "other",
];

export const LEADERSHIP_HANDOFF_STATUSES: LeadershipHandoffStatus[] = [
  "not_started",
  "identified",
  "in_training",
  "ready",
  "completed",
];

/** Progress weight for each handoff stage, used to score overall continuity. */
const STATUS_PROGRESS: Record<LeadershipHandoffStatus, number> = {
  not_started: 0,
  identified: 0.25,
  in_training: 0.55,
  ready: 0.85,
  completed: 1,
};

export function leadershipCategoryLabel(category: LeadershipCategory): string {
  const labels: Record<LeadershipCategory, string> = {
    leadership: "Team leadership",
    technical: "Technical / build",
    mentor: "Mentor",
    business: "Business / operations",
    safety: "Safety",
    other: "Other",
  };
  return labels[category];
}

export function leadershipHandoffStatusLabel(status: LeadershipHandoffStatus): string {
  const labels: Record<LeadershipHandoffStatus, string> = {
    not_started: "Not started",
    identified: "Successor identified",
    in_training: "In training",
    ready: "Ready to transition",
    completed: "Handoff complete",
  };
  return labels[status];
}

/**
 * Aggregate leadership roles into totals + breakdowns + a 0..1 continuity score. The
 * score blends successor coverage (has a named successor at all) with handoff progress
 * (how far along the identified successors are), so a roster of roles with successors
 * "identified" but never trained still reads as only partially resilient.
 */
export function summarizeLeadership(roles: LeadershipRole[]): LeadershipSummary {
  const statusMap = new Map<LeadershipHandoffStatus, number>();
  const categoryMap = new Map<LeadershipCategory, { count: number; withSuccessor: number }>();

  let withSuccessor = 0;
  let progressSum = 0;

  for (const role of roles) {
    statusMap.set(role.handoffStatus, (statusMap.get(role.handoffStatus) ?? 0) + 1);

    const cat = categoryMap.get(role.category) ?? { count: 0, withSuccessor: 0 };
    cat.count += 1;
    const hasSuccessor = Boolean(role.successorName && role.successorName.trim());
    if (hasSuccessor) {
      cat.withSuccessor += 1;
      withSuccessor += 1;
    }
    categoryMap.set(role.category, cat);

    progressSum += STATUS_PROGRESS[role.handoffStatus];
  }

  const byStatus = LEADERSHIP_HANDOFF_STATUSES.map((status) => ({
    status,
    count: statusMap.get(status) ?? 0,
  })).filter((row) => row.count > 0);

  const byCategory = [...categoryMap.entries()]
    .map(([category, value]) => ({ category, count: value.count, withSuccessor: value.withSuccessor }))
    .sort((a, b) => b.count - a.count);

  const totalRoles = roles.length;
  const coverage = totalRoles > 0 ? clamp01(withSuccessor / totalRoles) : 0;
  const progress = totalRoles > 0 ? clamp01(progressSum / totalRoles) : 0;
  const continuityScore = totalRoles > 0 ? round(0.5 * coverage + 0.5 * progress) : 0;

  return {
    totalRoles,
    withSuccessor,
    withoutSuccessor: totalRoles - withSuccessor,
    byStatus,
    byCategory,
    continuityScore,
  };
}

function tierFor(score: number): LeadershipTier {
  if (score >= 0.66) return "resilient";
  if (score >= 0.33) return "developing";
  return "at_risk";
}

/**
 * Turn a role summary into a readiness read: overall score/tier, the underlying coverage
 * and progress components, the specific roles still without a successor, and concrete
 * next steps. Grounded entirely in what was logged — no roster means score 0.
 */
export function computeLeadershipReadiness(
  summary: LeadershipSummary,
  roles: LeadershipRole[],
): LeadershipReadiness {
  const rolesAtRisk = roles
    .filter((role) => !role.successorName || !role.successorName.trim())
    .map((role) => role.roleTitle);

  const recommendations: string[] = [];
  if (summary.totalRoles === 0) {
    recommendations.push("Add your team's key leadership and technical roles to start succession planning.");
  } else {
    if (summary.withoutSuccessor > 0) {
      recommendations.push(
        `Identify a successor for ${summary.withoutSuccessor} role(s): ${rolesAtRisk.slice(0, 5).join(", ")}${rolesAtRisk.length > 5 ? ", …" : ""}.`,
      );
    }
    const inTraining = summary.byStatus.find((row) => row.status === "in_training")?.count ?? 0;
    const identified = summary.byStatus.find((row) => row.status === "identified")?.count ?? 0;
    if (identified > inTraining && identified > 0) {
      recommendations.push("Move identified successors into active training before the season ends.");
    }
    if (recommendations.length === 0) {
      recommendations.push("Continuity coverage looks solid — keep handoff notes current as roles progress.");
    }
  }

  return {
    score: summary.continuityScore,
    tier: tierFor(summary.continuityScore),
    coverage: round(summary.totalRoles > 0 ? summary.withSuccessor / summary.totalRoles : 0),
    progress: round(
      summary.totalRoles > 0
        ? roles.reduce((sum, role) => sum + STATUS_PROGRESS[role.handoffStatus], 0) / summary.totalRoles
        : 0,
    ),
    rolesAtRisk,
    recommendations,
  };
}
