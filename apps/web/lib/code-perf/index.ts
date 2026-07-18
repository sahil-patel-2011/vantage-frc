// Pure helper functions for the code-vs-match regression detective — no I/O, unit-testable.

import type {
  ChangeCorrelation,
  ChangeType,
  CodePerfChange,
  CodePerfMatchResult,
  CodePerfSummary,
  CorrelationVerdict,
  Subsystem,
} from "./types";

export const CHANGE_TYPES: ChangeType[] = ["commit", "software_version", "tuning"];

export const SUBSYSTEMS: Subsystem[] = [
  "drivetrain",
  "intake",
  "shooter",
  "climber",
  "vision",
  "autonomous",
  "general",
  "other",
];

const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  commit: "Commit",
  software_version: "Software version",
  tuning: "Tuning change",
};

const SUBSYSTEM_LABELS: Record<Subsystem, string> = {
  drivetrain: "Drivetrain",
  intake: "Intake",
  shooter: "Shooter",
  climber: "Climber",
  vision: "Vision",
  autonomous: "Autonomous",
  general: "General",
  other: "Other",
};

const VERDICT_LABELS: Record<CorrelationVerdict, string> = {
  improved: "Improved",
  regressed: "Regressed",
  neutral: "Neutral",
  insufficient_data: "Insufficient data",
};

export function changeTypeLabel(type: ChangeType): string {
  return CHANGE_TYPE_LABELS[type];
}

export function subsystemLabel(subsystem: Subsystem): string {
  return SUBSYSTEM_LABELS[subsystem];
}

export function verdictLabel(verdict: CorrelationVerdict): string {
  return VERDICT_LABELS[verdict];
}

const MIN_WINDOW_MATCHES = 2;
const IMPROVEMENT_THRESHOLD_POINTS = 1;

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round2(value: number | null): number | null {
  return value == null ? null : Math.round(value * 100) / 100;
}

/**
 * Correlates a single change against logged match results: takes up to `windowSize` matches
 * immediately before and after the change's date, and diffs the average auto/teleop points.
 * Purely deterministic — never fabricates a verdict when there isn't enough surrounding data.
 */
export function correlateChange(
  change: { occurredOn: string },
  matches: CodePerfMatchResult[],
  windowSize = 5,
): ChangeCorrelation {
  const sorted = [...matches].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  const before = sorted.filter((m) => m.occurredOn < change.occurredOn).slice(-windowSize);
  const after = sorted.filter((m) => m.occurredOn >= change.occurredOn).slice(0, windowSize);

  const avgAutoBefore = round2(avg(before.map((m) => m.autoPoints)));
  const avgTeleopBefore = round2(avg(before.map((m) => m.teleopPoints)));
  const avgAutoAfter = round2(avg(after.map((m) => m.autoPoints)));
  const avgTeleopAfter = round2(avg(after.map((m) => m.teleopPoints)));

  if (before.length < MIN_WINDOW_MATCHES || after.length < MIN_WINDOW_MATCHES) {
    return {
      verdict: "insufficient_data",
      deltaAuto: null,
      deltaTeleop: null,
      deltaTotal: null,
      matchesBefore: before.length,
      matchesAfter: after.length,
      avgAutoBefore,
      avgTeleopBefore,
      avgAutoAfter,
      avgTeleopAfter,
      rationale: `Need at least ${MIN_WINDOW_MATCHES} logged matches before and after this change (have ${before.length} before, ${after.length} after).`,
    };
  }

  const deltaAuto = round2((avgAutoAfter ?? 0) - (avgAutoBefore ?? 0));
  const deltaTeleop = round2((avgTeleopAfter ?? 0) - (avgTeleopBefore ?? 0));
  const deltaTotal = round2((deltaAuto ?? 0) + (deltaTeleop ?? 0));

  let verdict: CorrelationVerdict = "neutral";
  if ((deltaTotal ?? 0) >= IMPROVEMENT_THRESHOLD_POINTS) verdict = "improved";
  else if ((deltaTotal ?? 0) <= -IMPROVEMENT_THRESHOLD_POINTS) verdict = "regressed";

  const direction = verdict === "improved" ? "up" : verdict === "regressed" ? "down" : "roughly flat";
  const rationale =
    `Avg auto+teleop went ${direction} by ${Math.abs(deltaTotal ?? 0)} pt across ${before.length} match(es) before ` +
    `vs ${after.length} after (auto ${avgAutoBefore}→${avgAutoAfter}, teleop ${avgTeleopBefore}→${avgTeleopAfter}).`;

  return {
    verdict,
    deltaAuto,
    deltaTeleop,
    deltaTotal,
    matchesBefore: before.length,
    matchesAfter: after.length,
    avgAutoBefore,
    avgTeleopBefore,
    avgAutoAfter,
    avgTeleopAfter,
    rationale,
  };
}

export function summarizeCodePerf(changes: CodePerfChange[], matchCount: number): CodePerfSummary {
  const bySubsystemMap = new Map<Subsystem, { changes: number; improved: number; regressed: number }>();
  let improved = 0;
  let regressed = 0;
  let neutral = 0;
  let insufficientData = 0;
  let analyzedChanges = 0;

  for (const change of changes) {
    const bucket = bySubsystemMap.get(change.subsystem) ?? { changes: 0, improved: 0, regressed: 0 };
    bucket.changes += 1;
    if (change.verdict === "improved") bucket.improved += 1;
    if (change.verdict === "regressed") bucket.regressed += 1;
    bySubsystemMap.set(change.subsystem, bucket);

    if (change.verdict === "improved") improved += 1;
    else if (change.verdict === "regressed") regressed += 1;
    else if (change.verdict === "neutral") neutral += 1;
    else insufficientData += 1;

    if (change.verdict !== "insufficient_data") analyzedChanges += 1;
  }

  const bySubsystem = SUBSYSTEMS.filter((s) => bySubsystemMap.has(s)).map((subsystem) => ({
    subsystem,
    ...bySubsystemMap.get(subsystem)!,
  }));

  return {
    totalChanges: changes.length,
    analyzedChanges,
    improved,
    regressed,
    neutral,
    insufficientData,
    totalMatches: matchCount,
    bySubsystem,
  };
}
