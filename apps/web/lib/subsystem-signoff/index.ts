// Subsystem sign-off rollups. Pure aggregation over subsystems + their gate decisions —
// deterministic given its input, no clock, no I/O.

export * from "./types";
export {
  SIGNOFF_BUILD_RELATED_INCLUDE,
  SIGNOFF_RELATED_LINKS,
  formatSignoffReadinessDisplay,
  formatSubsystemCompletionDisplay,
  shouldShowSignoffSummaryTiles,
  signoffNextActions,
  signoffRelatedLinks,
  signoffTierTone,
  type SignoffNextAction,
  type SignoffRelatedId,
  type SignoffRelatedLink,
} from "./subsystem-signoff-related";

import type {
  GateState,
  SignoffDecision,
  SignoffGate,
  SignoffRecord,
  Subsystem,
  SubsystemCategory,
  SubsystemScore,
  SubsystemSignoffReadiness,
  SubsystemSignoffSummary,
  SubsystemSignoffTier,
  SubsystemStatus,
} from "./types";

export const SUBSYSTEM_CATEGORIES: SubsystemCategory[] = [
  "drivetrain",
  "intake",
  "scoring",
  "climber",
  "electrical",
  "software",
  "other",
];

export const SUBSYSTEM_STATUSES: SubsystemStatus[] = [
  "in_progress",
  "ready_for_review",
  "signed_off",
  "blocked",
];

/** The required review gates, in the order a subsystem typically clears them. */
export const SIGNOFF_GATES: SignoffGate[] = [
  "design",
  "fabrication",
  "assembly",
  "wiring",
  "programming",
  "field_test",
];

export const SIGNOFF_DECISIONS: SignoffDecision[] = ["approved", "rejected"];

const round2 = (value: number) => Math.round(value * 100) / 100;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function subsystemCategoryLabel(category: SubsystemCategory): string {
  const labels: Record<SubsystemCategory, string> = {
    drivetrain: "Drivetrain",
    intake: "Intake",
    scoring: "Scoring mechanism",
    climber: "Climber",
    electrical: "Electrical",
    software: "Software",
    other: "Other",
  };
  return labels[category];
}

export function subsystemStatusLabel(status: SubsystemStatus): string {
  const labels: Record<SubsystemStatus, string> = {
    in_progress: "In progress",
    ready_for_review: "Ready for review",
    signed_off: "Signed off",
    blocked: "Blocked",
  };
  return labels[status];
}

export function signoffGateLabel(gate: SignoffGate): string {
  const labels: Record<SignoffGate, string> = {
    design: "Design review",
    fabrication: "Fabrication",
    assembly: "Assembly",
    wiring: "Wiring",
    programming: "Programming",
    field_test: "Field test",
  };
  return labels[gate];
}

/**
 * Resolve, for a subsystem, the current decision on each required gate. The latest record for a
 * gate (by signed date, then insertion order — records arrive newest-first) wins, so a later
 * rejection correctly reopens a gate that was previously approved.
 */
function resolveGates(records: SignoffRecord[]): GateState[] {
  const latest = new Map<SignoffGate, SignoffRecord>();
  // Records are expected newest-first; keep the first seen per gate as the current decision.
  for (const record of records) {
    if (!latest.has(record.gate)) latest.set(record.gate, record);
  }
  return SIGNOFF_GATES.map((gate) => {
    const record = latest.get(gate);
    return {
      gate,
      decision: record ? record.decision : null,
      signedOn: record ? record.signedOn : null,
    } satisfies GateState;
  });
}

/**
 * Aggregate subsystems + their sign-off records into per-subsystem gate completion, ordered by
 * completion descending. Subsystems with no records still appear (0 completion) so the build
 * board stays visible while sign-offs are in progress.
 */
export function summarizeSubsystemSignoff(
  subsystems: Subsystem[],
  records: SignoffRecord[],
): SubsystemSignoffSummary {
  const bySubsystem = new Map<string, SignoffRecord[]>();
  for (const record of records) {
    const list = bySubsystem.get(record.subsystemId) ?? [];
    list.push(record);
    bySubsystem.set(record.subsystemId, list);
  }

  const gatesTotal = SIGNOFF_GATES.length;
  let approvedGatesAll = 0;

  const subsystemScores: SubsystemScore[] = subsystems
    .map((subsystem) => {
      const gates = resolveGates(bySubsystem.get(subsystem.id) ?? []);
      const approvedGates = gates.filter((g) => g.decision === "approved").length;
      const rejectedGates = gates.filter((g) => g.decision === "rejected").length;
      approvedGatesAll += approvedGates;
      return {
        subsystemId: subsystem.id,
        subsystem,
        gates,
        approvedGates,
        rejectedGates,
        gatesTotal,
        fullyApproved: approvedGates === gatesTotal,
        completion: round2(approvedGates / gatesTotal),
      } satisfies SubsystemScore;
    })
    .sort((a, b) => b.completion - a.completion);

  return {
    totalSubsystems: subsystems.length,
    startedSubsystems: subsystems.filter((s) => (bySubsystem.get(s.id) ?? []).length > 0).length,
    signedOffSubsystems: subsystemScores.filter((s) => s.fullyApproved).length,
    blockedSubsystems: subsystems.filter((s) => s.status === "blocked").length,
    totalGates: subsystems.length * gatesTotal,
    approvedGates: approvedGatesAll,
    subsystemScores,
  };
}

function tierFor(score: number): SubsystemSignoffTier {
  if (score >= 0.66) return "ready";
  if (score > 0) return "in_progress";
  return "not_started";
}

/**
 * Competition readiness: never fabricated — an empty board or unsigned subsystems read as
 * "not_started". Blends breadth (every subsystem has started sign-off) with depth (every
 * required gate approved on every subsystem).
 */
export function computeSubsystemSignoffReadiness(
  summary: SubsystemSignoffSummary,
): SubsystemSignoffReadiness {
  if (summary.totalSubsystems === 0) {
    return {
      score: 0,
      tier: "not_started",
      subsystemsFullyApproved: 0,
      recommendations: ["Add the robot subsystems you need to sign off before competition."],
    };
  }

  const breadth = clamp01(summary.startedSubsystems / summary.totalSubsystems);
  const depth = clamp01(summary.approvedGates / Math.max(1, summary.totalGates));
  const score = round2(0.5 * breadth + 0.5 * depth);

  const recommendations: string[] = [];
  const unstarted = summary.totalSubsystems - summary.startedSubsystems;
  if (unstarted > 0) {
    recommendations.push(
      `${unstarted} subsystem(s) have no sign-offs yet — start the design review gate to open the trail.`,
    );
  }
  if (summary.blockedSubsystems > 0) {
    recommendations.push(
      `${summary.blockedSubsystems} subsystem(s) are blocked — resolve blockers before the freeze.`,
    );
  }
  const remainingGates = summary.totalGates - summary.approvedGates;
  if (remainingGates > 0 && unstarted === 0) {
    recommendations.push(
      `${remainingGates} gate(s) still need approval across your subsystems.`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push("Every subsystem has cleared all required gates — the robot is signed off.");
  }

  return {
    score,
    tier: tierFor(score),
    subsystemsFullyApproved: summary.signedOffSubsystems,
    recommendations,
  };
}
