// Pure, unit-testable helpers for the field-count budget linter. No I/O, no framework imports.

export * from "./types";
import type {
  FieldBudgetLintResult,
  FieldBudgetPhase,
  FieldBudgetPhaseResult,
  FieldBudgetSeverity,
  FieldBudgetSnapshot,
  FieldBudgetSummary,
} from "./types";

export const FIELD_BUDGET_PHASES: FieldBudgetPhase[] = ["auto", "teleop", "endgame", "pit", "post_match"];

/**
 * Realistic per-match field-count budgets. Live-match phases (auto/teleop/endgame) are timed —
 * a scout only has a few seconds per action — so their budgets are tight. Pit and post-match
 * phases are untimed (filled between/after matches) so they tolerate more fields.
 */
export const DEFAULT_PHASE_BUDGETS: Record<FieldBudgetPhase, number> = {
  auto: 8,
  teleop: 15,
  endgame: 5,
  pit: 30,
  post_match: 8,
};

/** Combined budget for the three timed, in-match phases a single scout must track live. */
export const LIVE_MATCH_BUDGET =
  DEFAULT_PHASE_BUDGETS.auto + DEFAULT_PHASE_BUDGETS.teleop + DEFAULT_PHASE_BUDGETS.endgame;

export function fieldBudgetPhaseLabel(phase: FieldBudgetPhase): string {
  switch (phase) {
    case "auto":
      return "Autonomous";
    case "teleop":
      return "Teleop";
    case "endgame":
      return "Endgame";
    case "pit":
      return "Pit scouting";
    case "post_match":
      return "Post-match";
    default:
      return phase;
  }
}

function phaseResult(
  phase: FieldBudgetPhase,
  count: number,
  budgets: Record<FieldBudgetPhase, number>,
): FieldBudgetPhaseResult {
  const budget = budgets[phase];
  const overBy = Math.max(0, count - budget);
  return { phase, count, budget, overBudget: overBy > 0, overBy };
}

/** Lint a single schema snapshot against phase budgets. Pure — no I/O. */
export function lintSnapshot(
  snapshot: {
    id: string;
    schemaName: string;
    autoFields: number;
    teleopFields: number;
    endgameFields: number;
    pitFields: number;
    postMatchFields: number;
  },
  budgets: Record<FieldBudgetPhase, number> = DEFAULT_PHASE_BUDGETS,
): FieldBudgetLintResult {
  const phases: FieldBudgetPhaseResult[] = [
    phaseResult("auto", snapshot.autoFields, budgets),
    phaseResult("teleop", snapshot.teleopFields, budgets),
    phaseResult("endgame", snapshot.endgameFields, budgets),
    phaseResult("pit", snapshot.pitFields, budgets),
    phaseResult("post_match", snapshot.postMatchFields, budgets),
  ];

  const liveFields = snapshot.autoFields + snapshot.teleopFields + snapshot.endgameFields;
  const liveBudget = budgets.auto + budgets.teleop + budgets.endgame;
  const totalFields =
    liveFields + snapshot.pitFields + snapshot.postMatchFields;

  const liveOverBy = Math.max(0, liveFields - liveBudget);
  const worstLivePhaseOver = Math.max(
    phases.find((p) => p.phase === "auto")!.overBy,
    phases.find((p) => p.phase === "teleop")!.overBy,
    phases.find((p) => p.phase === "endgame")!.overBy,
  );

  let severity: FieldBudgetSeverity = "ok";
  if (liveOverBy > 0 || worstLivePhaseOver > 0) {
    // Critical when the live-match total blows the budget by 25%+, or any single timed phase
    // is over by more than a third of its own budget — either means matches will fall behind.
    const criticalByTotal = liveFields > liveBudget * 1.25;
    const criticalByPhase = phases.some(
      (p) => p.phase !== "pit" && p.phase !== "post_match" && p.overBy > p.budget / 3,
    );
    severity = criticalByTotal || criticalByPhase ? "critical" : "warning";
  }

  const recommendations: string[] = [];
  for (const phase of phases) {
    if (phase.phase === "pit" || phase.phase === "post_match") continue;
    if (phase.overBudget) {
      recommendations.push(
        `${fieldBudgetPhaseLabel(phase.phase)} has ${phase.count} fields, ${phase.overBy} over the ${phase.budget}-field budget — cut or merge fields to keep scouts on pace.`,
      );
    }
  }
  if (recommendations.length === 0 && (snapshot.pitFields > budgets.pit || snapshot.postMatchFields > budgets.post_match)) {
    recommendations.push("Pit or post-match fields exceed the untimed budget — consider trimming for scout fatigue.");
  }

  return {
    snapshotId: snapshot.id,
    schemaName: snapshot.schemaName,
    totalFields,
    liveFields,
    liveBudget,
    severity,
    overBudget: severity !== "ok",
    phases,
    recommendations,
  };
}

/** Summarize a set of lint results (most recent first) into an at-a-glance view. */
export function summarizeSnapshots(
  snapshots: FieldBudgetSnapshot[],
  budgets: Record<FieldBudgetPhase, number> = DEFAULT_PHASE_BUDGETS,
): FieldBudgetSummary {
  if (snapshots.length === 0) {
    return {
      totalSnapshots: 0,
      latest: null,
      overBudgetCount: 0,
      okCount: 0,
      averageLiveFields: 0,
      worstPhase: null,
    };
  }

  const results = snapshots.map((snapshot) => lintSnapshot(snapshot, budgets));
  const overBudgetCount = results.filter((r) => r.overBudget).length;
  const totalLive = results.reduce((sum, r) => sum + r.liveFields, 0);

  const overCounts: Record<FieldBudgetPhase, number> = {
    auto: 0,
    teleop: 0,
    endgame: 0,
    pit: 0,
    post_match: 0,
  };
  for (const result of results) {
    for (const phase of result.phases) {
      if (phase.overBudget) overCounts[phase.phase] += 1;
    }
  }
  let worstPhase: FieldBudgetPhase | null = null;
  let worstCount = 0;
  for (const phase of FIELD_BUDGET_PHASES) {
    if (overCounts[phase] > worstCount) {
      worstCount = overCounts[phase];
      worstPhase = phase;
    }
  }

  return {
    totalSnapshots: snapshots.length,
    latest: results[0] ?? null,
    overBudgetCount,
    okCount: results.length - overBudgetCount,
    averageLiveFields: Math.round(totalLive / results.length),
    worstPhase,
  };
}
