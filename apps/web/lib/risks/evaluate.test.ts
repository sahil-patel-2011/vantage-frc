import { describe, expect, it } from "vitest";
import { evaluateRisk, levelForScore, riskMatrix, summarizeRisks } from "./evaluate";
import type { RiskCategory, RiskStatus, TeamRisk } from "./types";

let seq = 0;
function risk(overrides: Partial<TeamRisk> = {}): TeamRisk {
  seq += 1;
  return {
    id: `r-${seq}`,
    title: `Risk ${seq}`,
    category: "technical" as RiskCategory,
    likelihood: 3,
    impact: 3,
    status: "open" as RiskStatus,
    mitigation: null,
    owner: null,
    dueOn: null,
    notes: null,
    seasonYear: 2026,
    ...overrides,
  };
}

const ASOF = "2026-02-15";

describe("levelForScore", () => {
  it("maps scores to the standard 5x5 bands", () => {
    expect(levelForScore(25)).toBe("critical");
    expect(levelForScore(20)).toBe("critical");
    expect(levelForScore(16)).toBe("high");
    expect(levelForScore(12)).toBe("high");
    expect(levelForScore(10)).toBe("moderate");
    expect(levelForScore(6)).toBe("moderate");
    expect(levelForScore(5)).toBe("low");
    expect(levelForScore(1)).toBe("low");
  });
});

describe("evaluateRisk", () => {
  it("scores likelihood x impact and clamps to 1..5", () => {
    expect(evaluateRisk(risk({ likelihood: 4, impact: 5 }), ASOF).score).toBe(20);
    expect(evaluateRisk(risk({ likelihood: 9, impact: 9 }), ASOF).score).toBe(25); // clamped
    expect(evaluateRisk(risk({ likelihood: 0, impact: 0 }), ASOF).score).toBe(1); // clamped to 1x1
  });

  it("marks closed risks inactive", () => {
    expect(evaluateRisk(risk({ status: "closed" }), ASOF).active).toBe(false);
    expect(evaluateRisk(risk({ status: "accepted" }), ASOF).active).toBe(true);
  });

  it("flags overdue only for actionable statuses with a passed due date", () => {
    expect(evaluateRisk(risk({ status: "open", dueOn: "2026-02-01" }), ASOF).overdue).toBe(true);
    expect(evaluateRisk(risk({ status: "mitigating", dueOn: "2026-02-01" }), ASOF).overdue).toBe(true);
    // monitoring/accepted are not actively actionable -> not "overdue"
    expect(evaluateRisk(risk({ status: "monitoring", dueOn: "2026-02-01" }), ASOF).overdue).toBe(false);
    expect(evaluateRisk(risk({ status: "open", dueOn: "2026-03-01" }), ASOF).overdue).toBe(false);
  });
});

describe("riskMatrix", () => {
  it("returns 25 cells covering the full grid, counting only active risks", () => {
    const cells = riskMatrix(
      [
        risk({ likelihood: 5, impact: 5 }),
        risk({ likelihood: 5, impact: 5 }),
        risk({ likelihood: 1, impact: 1, status: "closed" }), // inactive, not counted
      ],
      ASOF,
    );
    expect(cells).toHaveLength(25);
    const topCell = cells.find((c) => c.likelihood === 5 && c.impact === 5);
    expect(topCell?.count).toBe(2);
    expect(topCell?.level).toBe("critical");
    const lowCell = cells.find((c) => c.likelihood === 1 && c.impact === 1);
    expect(lowCell?.count).toBe(0); // closed risk excluded
  });
});

describe("summarizeRisks", () => {
  it("is all-zero for no risks", () => {
    const s = summarizeRisks([], ASOF);
    expect(s.total).toBe(0);
    expect(s.active).toBe(0);
    expect(s.topRisks).toEqual([]);
    expect(s.highestScore).toBe(0);
    expect(s.byLevel.critical).toBe(0);
  });

  it("counts active risks by level and excludes closed ones", () => {
    const s = summarizeRisks(
      [
        risk({ likelihood: 5, impact: 5 }), // 25 critical
        risk({ likelihood: 3, impact: 4 }), // 12 high
        risk({ likelihood: 2, impact: 3 }), // 6 moderate
        risk({ likelihood: 1, impact: 2 }), // 2 low
        risk({ likelihood: 5, impact: 5, status: "closed" }), // excluded
      ],
      ASOF,
    );
    expect(s.total).toBe(5);
    expect(s.active).toBe(4);
    expect(s.byLevel).toEqual({ critical: 1, high: 1, moderate: 1, low: 1 });
    expect(s.highestScore).toBe(25);
  });

  it("ranks top risks by score descending", () => {
    const s = summarizeRisks(
      [
        risk({ title: "small", likelihood: 1, impact: 2 }),
        risk({ title: "big", likelihood: 5, impact: 5 }),
        risk({ title: "mid", likelihood: 3, impact: 3 }),
      ],
      ASOF,
    );
    expect(s.topRisks.map((e) => e.risk.title)).toEqual(["big", "mid", "small"]);
  });

  it("rolls up by category and surfaces overdue mitigations", () => {
    const s = summarizeRisks(
      [
        risk({ category: "funding", likelihood: 4, impact: 4, status: "open", dueOn: "2026-02-01" }), // overdue
        risk({ category: "funding", likelihood: 2, impact: 2 }),
        risk({ category: "technical", likelihood: 5, impact: 5 }),
      ],
      ASOF,
    );
    const funding = s.byCategory.find((c) => c.category === "funding");
    expect(funding?.active).toBe(2);
    expect(s.overdue).toHaveLength(1);
    expect(s.overdue[0]?.risk.category).toBe("funding");
  });

  it("counts every status", () => {
    const s = summarizeRisks(
      [risk({ status: "open" }), risk({ status: "mitigating" }), risk({ status: "closed" })],
      ASOF,
    );
    expect(s.byStatus.open).toBe(1);
    expect(s.byStatus.mitigating).toBe(1);
    expect(s.byStatus.closed).toBe(1);
  });
});
