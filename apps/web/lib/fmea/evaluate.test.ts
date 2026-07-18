import { describe, expect, it } from "vitest";
import { evaluateFailure, levelForRpn, summarizeFailures } from "./evaluate";
import type { FmeaContext, FmeaFailure, FmeaStatus } from "./types";

let seq = 0;
function failure(overrides: Partial<FmeaFailure> = {}): FmeaFailure {
  seq += 1;
  return {
    id: `f-${seq}`,
    title: `Failure ${seq}`,
    failureMode: "belt slip",
    context: "pit" as FmeaContext,
    subsystemId: null,
    subsystemName: "Intake",
    occurrence: 3,
    severity: 3,
    detection: 3,
    rootCause: null,
    fiveWhys: null,
    fix: null,
    status: "open" as FmeaStatus,
    inspectionItemId: null,
    eventKey: null,
    matchKey: null,
    robotLabel: "competition",
    occurredAt: "2026-03-01T12:00:00.000Z",
    seasonYear: 2026,
    recordedByName: "Mentor",
    ...overrides,
  };
}

describe("levelForRpn", () => {
  it("maps classic RPN bands", () => {
    expect(levelForRpn(500)).toBe("critical");
    expect(levelForRpn(200)).toBe("critical");
    expect(levelForRpn(150)).toBe("high");
    expect(levelForRpn(100)).toBe("high");
    expect(levelForRpn(50)).toBe("moderate");
    expect(levelForRpn(40)).toBe("moderate");
    expect(levelForRpn(27)).toBe("low");
    expect(levelForRpn(1)).toBe("low");
  });
});

describe("evaluateFailure", () => {
  it("computes O×S×D and clamps to 1..10", () => {
    expect(evaluateFailure(failure({ occurrence: 4, severity: 5, detection: 2 })).rpn).toBe(40);
    expect(evaluateFailure(failure({ occurrence: 99, severity: 99, detection: 99 })).rpn).toBe(1000);
    expect(evaluateFailure(failure({ occurrence: 0, severity: 0, detection: 0 })).rpn).toBe(1);
  });

  it("marks verified/closed inactive and flags missing fixes", () => {
    expect(evaluateFailure(failure({ status: "closed" })).active).toBe(false);
    expect(evaluateFailure(failure({ status: "verified" })).active).toBe(false);
    expect(evaluateFailure(failure({ status: "open", fix: null })).needsFix).toBe(true);
    expect(evaluateFailure(failure({ status: "fixing", fix: "  " })).needsFix).toBe(true);
    expect(evaluateFailure(failure({ status: "open", fix: "Replace belt" })).needsFix).toBe(false);
  });
});

describe("summarizeFailures", () => {
  it("is all-zero for an empty log", () => {
    const summary = summarizeFailures([]);
    expect(summary.total).toBe(0);
    expect(summary.active).toBe(0);
    expect(summary.highestRpn).toBe(0);
    expect(summary.bySubsystem).toEqual([]);
  });

  it("ranks subsystems by failure count so the weakest system is queryable", () => {
    const summary = summarizeFailures([
      failure({ subsystemName: "Intake", occurrence: 5, severity: 4, detection: 4 }),
      failure({ subsystemName: "Intake", occurrence: 3, severity: 3, detection: 3, status: "closed" }),
      failure({ subsystemName: "Elevator", occurrence: 8, severity: 8, detection: 5 }),
      failure({ subsystemName: "Drivetrain", occurrence: 2, severity: 2, detection: 2 }),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.active).toBe(3);
    expect(summary.bySubsystem[0]?.subsystemName).toBe("Intake");
    expect(summary.bySubsystem[0]?.count).toBe(2);
    expect(summary.bySubsystem[1]?.subsystemName).toBe("Elevator");
    expect(summary.highestRpn).toBe(320);
    expect(summary.topFailures[0]?.failure.subsystemName).toBe("Elevator");
    expect(summary.needsFix.length).toBe(3);
  });
});
