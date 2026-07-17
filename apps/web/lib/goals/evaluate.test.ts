import { describe, expect, it } from "vitest";
import { evaluateGoal, formatGoalValue, summarizeGoals } from "./evaluate";
import type { GoalPriority, MetricType, SeasonGoal } from "./types";

let seq = 0;
function goal(overrides: Partial<SeasonGoal> = {}): SeasonGoal {
  seq += 1;
  return {
    id: `g-${seq}`,
    title: `Goal ${seq}`,
    category: "technical",
    metricType: "count" as MetricType,
    targetValue: 10,
    currentValue: 0,
    unit: null,
    dueOn: null,
    priority: "normal" as GoalPriority,
    notes: null,
    seasonYear: 2026,
    ...overrides,
  };
}

const ASOF = "2026-02-15";

describe("evaluateGoal", () => {
  it("computes fractional progress for count goals", () => {
    const e = evaluateGoal(goal({ targetValue: 80, currentValue: 40 }), ASOF);
    expect(e.progress).toBe(0.5);
    expect(e.status).toBe("in_progress");
  });

  it("caps progress at 1 and marks achieved", () => {
    const e = evaluateGoal(goal({ targetValue: 10, currentValue: 15 }), ASOF);
    expect(e.progress).toBe(1);
    expect(e.status).toBe("achieved");
  });

  it("treats binary goals as done/not done", () => {
    expect(evaluateGoal(goal({ metricType: "binary", targetValue: 1, currentValue: 0 }), ASOF).status).toBe("not_started");
    expect(evaluateGoal(goal({ metricType: "binary", targetValue: 1, currentValue: 1 }), ASOF).status).toBe("achieved");
  });

  it("marks a goal missed when its due date passed unfinished", () => {
    const e = evaluateGoal(goal({ targetValue: 10, currentValue: 3, dueOn: "2026-02-01" }), ASOF);
    expect(e.status).toBe("missed");
    expect(e.daysToDue).toBe(-14);
  });

  it("marks a goal at risk when due soon and behind", () => {
    const e = evaluateGoal(goal({ targetValue: 10, currentValue: 2, dueOn: "2026-02-20" }), ASOF);
    expect(e.status).toBe("at_risk");
  });

  it("is not at risk when due soon but nearly complete", () => {
    const e = evaluateGoal(goal({ targetValue: 10, currentValue: 8, dueOn: "2026-02-20" }), ASOF);
    expect(e.status).toBe("in_progress");
  });

  it("handles a zero/blank target without dividing by zero", () => {
    expect(evaluateGoal(goal({ targetValue: 0, currentValue: 0 }), ASOF).progress).toBe(0);
    expect(evaluateGoal(goal({ targetValue: 0, currentValue: 5 }), ASOF).progress).toBe(1);
  });
});

describe("summarizeGoals", () => {
  it("is all-zero for no goals", () => {
    const s = summarizeGoals([], ASOF);
    expect(s.total).toBe(0);
    expect(s.achievedPct).toBe(0);
    expect(s.weightedProgress).toBe(0);
    expect(s.byCategory).toEqual([]);
    expect(s.needsAttention).toEqual([]);
  });

  it("counts achieved and averages progress", () => {
    const s = summarizeGoals(
      [
        goal({ targetValue: 10, currentValue: 10 }), // 1.0 achieved
        goal({ targetValue: 10, currentValue: 5 }), // 0.5
        goal({ targetValue: 10, currentValue: 0 }), // 0.0
      ],
      ASOF,
    );
    expect(s.achieved).toBe(1);
    expect(s.achievedPct).toBeCloseTo(0.333, 2);
    expect(s.avgProgress).toBe(0.5);
  });

  it("weights progress by priority", () => {
    const s = summarizeGoals(
      [
        goal({ priority: "high", targetValue: 10, currentValue: 10 }), // progress 1, weight 3
        goal({ priority: "low", targetValue: 10, currentValue: 0 }), // progress 0, weight 1
      ],
      ASOF,
    );
    // weighted = (1*3 + 0*1) / (3+1) = 0.75, vs simple mean 0.5
    expect(s.weightedProgress).toBe(0.75);
    expect(s.avgProgress).toBe(0.5);
  });

  it("rolls up by category in canonical order", () => {
    const s = summarizeGoals(
      [
        goal({ category: "outreach", targetValue: 10, currentValue: 10 }),
        goal({ category: "competition", targetValue: 10, currentValue: 5 }),
        goal({ category: "competition", targetValue: 10, currentValue: 5 }),
      ],
      ASOF,
    );
    expect(s.byCategory.map((c) => c.category)).toEqual(["competition", "outreach"]);
    const comp = s.byCategory.find((c) => c.category === "competition");
    expect(comp?.total).toBe(2);
    expect(comp?.avgProgress).toBe(0.5);
  });

  it("surfaces missed before at-risk in needsAttention", () => {
    const s = summarizeGoals(
      [
        goal({ targetValue: 10, currentValue: 1, dueOn: "2026-02-18" }), // at_risk
        goal({ targetValue: 10, currentValue: 1, dueOn: "2026-02-01" }), // missed
        goal({ targetValue: 10, currentValue: 10 }), // achieved (excluded)
      ],
      ASOF,
    );
    expect(s.needsAttention).toHaveLength(2);
    expect(s.needsAttention[0]?.status).toBe("missed");
    expect(s.needsAttention[1]?.status).toBe("at_risk");
  });
});

describe("formatGoalValue", () => {
  it("formats each metric type", () => {
    expect(formatGoalValue(goal({ metricType: "binary", currentValue: 1 }))).toBe("Done");
    expect(formatGoalValue(goal({ metricType: "percent", targetValue: 90, currentValue: 45 }))).toBe("45 / 90%");
    expect(formatGoalValue(goal({ metricType: "currency", targetValue: 15000, currentValue: 12000 }))).toBe("$12,000 / $15,000");
    expect(formatGoalValue(goal({ metricType: "count", targetValue: 80, currentValue: 40, unit: "hours" }))).toBe("40 / 80 hours");
  });
});
