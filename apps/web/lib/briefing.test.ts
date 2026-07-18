import { describe, expect, it } from "vitest";
import {
  briefingChecklist,
  matchLabel,
  normalizePlan,
  ourAllianceOf,
  practiceReadiness,
  winProbabilityFor,
  type BriefingMatch,
  type BriefingPrediction,
} from "./briefing";
import type { DriverCycle, DriverSession } from "./driver-practice";

const US = "frc1678";

function match(overrides: Partial<BriefingMatch> = {}): BriefingMatch {
  return {
    matchKey: "2026casd_qm7",
    compLevel: "qm",
    matchNumber: 7,
    scheduledTime: null,
    red: [US, "frc254", "frc973"],
    blue: ["frc118", "frc148", "frc2056"],
    ...overrides,
  };
}

function prediction(overrides: Partial<BriefingPrediction> = {}): BriefingPrediction {
  return {
    pRed: 0.62,
    pBlue: 0.38,
    confidenceLow: 0.5,
    confidenceHigh: 0.74,
    modelVersion: "fusion-v3",
    keyFactors: [],
    caveats: [],
    scoredAt: "2026-03-14T15:00:00Z",
    ...overrides,
  };
}

let nextCycleId = 0;

function cycle(overrides: Partial<DriverCycle> = {}): DriverCycle {
  nextCycleId += 1;
  return {
    id: `c${nextCycleId}`,
    sessionId: "s1",
    action: "Full cycle",
    seconds: 10,
    success: true,
    note: "",
    repIndex: nextCycleId,
    createdAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function session(id: string, cycles: DriverCycle[]): DriverSession {
  return {
    id,
    title: "Practice",
    eventKey: null,
    sessionDate: "2026-03-01",
    driverUserId: null,
    driverName: null,
    location: "",
    goal: "",
    notes: "",
    attendanceEventId: null,
    attendanceEventTitle: null,
    attendanceOccurredOn: null,
    buildTaskId: null,
    buildTaskTitle: null,
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
    cycles,
  };
}

describe("ourAllianceOf", () => {
  it("returns red when the team sits on the red alliance", () => {
    expect(ourAllianceOf(match(), US)).toBe("red");
  });

  it("returns blue when the team sits on the blue alliance", () => {
    expect(ourAllianceOf(match(), "frc2056")).toBe("blue");
  });

  it("returns null when the team is not in the match", () => {
    expect(ourAllianceOf(match(), "frc9999")).toBeNull();
  });
});

describe("winProbabilityFor", () => {
  it("returns pRed for the red alliance", () => {
    expect(winProbabilityFor(prediction(), "red")).toBe(0.62);
  });

  it("returns pBlue for the blue alliance", () => {
    expect(winProbabilityFor(prediction(), "blue")).toBe(0.38);
  });

  it("returns null without a prediction or without an alliance", () => {
    expect(winProbabilityFor(null, "red")).toBeNull();
    expect(winProbabilityFor(prediction(), null)).toBeNull();
    expect(winProbabilityFor(null, null)).toBeNull();
  });
});

describe("normalizePlan", () => {
  it("maps a full playbook into the briefing plan shape", () => {
    const plan = normalizePlan({
      playbook: {
        title: "Control the midline",
        winProbability: 0.62,
        priorities: ["Score coral fast", "Deny their feeder lane"],
        strengthsToProtect: ["Auto consistency"],
        risksToMitigate: ["Climb timeouts"],
        checkpoints: ["T-30s start climb", "Auto done by 0:12"],
      },
    });
    expect(plan).toEqual({
      title: "Control the midline",
      priorities: ["Score coral fast", "Deny their feeder lane"],
      strengths: ["Auto consistency"],
      risks: ["Climb timeouts"],
      checkpoints: ["T-30s start climb", "Auto done by 0:12"],
    });
  });

  it("tolerates partial playbooks, coercing entries and dropping junk items", () => {
    const plan = normalizePlan({
      playbook: {
        title: "   ",
        priorities: ["Only priority", 42, { bad: true }, "  ", null],
      },
    });
    expect(plan).toEqual({
      title: null,
      priorities: ["Only priority", "42"],
      strengths: [],
      risks: [],
      checkpoints: [],
    });
  });

  it("returns null for garbage shapes with nothing usable", () => {
    expect(normalizePlan("nope")).toBeNull();
    expect(normalizePlan([1, 2, 3])).toBeNull();
    expect(normalizePlan({ playbook: "not-an-object" })).toBeNull();
    expect(normalizePlan({ playbook: { title: "", priorities: "not-an-array" } })).toBeNull();
  });

  it("returns null for null or missing input", () => {
    expect(normalizePlan(null)).toBeNull();
    expect(normalizePlan(undefined)).toBeNull();
    expect(normalizePlan({})).toBeNull();
  });
});

describe("practiceReadiness", () => {
  it("reports zero reps and null metrics with no practice data", () => {
    expect(practiceReadiness([])).toEqual({
      reps: 0,
      successRate: null,
      avgSeconds: null,
      bestSeconds: null,
      topActions: [],
    });
    expect(practiceReadiness([session("s1", [])]).reps).toBe(0);
  });

  it("fuses cycles across sessions and keeps only the top three actions by reps", () => {
    const sessions = [
      session("s1", [
        cycle({ sessionId: "s1", action: "Full cycle", seconds: 8, success: true }),
        cycle({ sessionId: "s1", action: "Full cycle", seconds: 12, success: false }),
        cycle({ sessionId: "s1", action: "Climb", seconds: 20, success: true }),
      ]),
      session("s2", [
        cycle({ sessionId: "s2", action: "Full cycle", seconds: null, success: true }),
        cycle({ sessionId: "s2", action: "Intake", seconds: null, success: true }),
        cycle({ sessionId: "s2", action: "Intake", seconds: 5, success: true }),
        cycle({ sessionId: "s2", action: "Score high", seconds: 7, success: true }),
      ]),
    ];
    const readiness = practiceReadiness(sessions);
    expect(readiness.reps).toBe(7);
    expect(readiness.successRate).toBe(86);
    expect(readiness.avgSeconds).toBe(10.4);
    expect(readiness.bestSeconds).toBe(5);
    expect(readiness.topActions).toEqual([
      { action: "Full cycle", reps: 3, successRate: 67, avgSeconds: 10 },
      { action: "Intake", reps: 2, successRate: 100, avgSeconds: 5 },
      { action: "Climb", reps: 1, successRate: 100, avgSeconds: 20 },
    ]);
  });
});

describe("briefingChecklist", () => {
  it("marks every row ok when every input is present", () => {
    const rows = briefingChecklist({
      hasPrediction: true,
      hasPlan: true,
      hasPlay: true,
      practiceReps: 12,
      intelCount: 2,
      scoutCount: 3,
    });
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.ok)).toBe(true);
    expect(rows.map((row) => row.label)).toEqual([
      "Prediction",
      "Strategy plan",
      "Whiteboard play",
      "Practice data",
      "Opponent video",
    ]);
  });

  it("marks every row missing with its do-this-next hint when nothing exists", () => {
    const rows = briefingChecklist({
      hasPrediction: false,
      hasPlan: false,
      hasPlay: false,
      practiceReps: 0,
      intelCount: 0,
      scoutCount: 0,
    });
    expect(rows.every((row) => !row.ok)).toBe(true);
    expect(rows.map((row) => row.hint)).toEqual([
      "Run /strategy",
      "Save a playbook in /strategy",
      "Draw one in /whiteboard and link the match",
      "Log reps in /practice",
      "Tag opponent reviews in /video",
    ]);
  });
});

describe("matchLabel", () => {
  it("maps known comp levels and uppercases unknown ones", () => {
    expect(matchLabel("qm", 42)).toBe("Qual 42");
    expect(matchLabel("qf", 2)).toBe("QF 2");
    expect(matchLabel("sf", 3)).toBe("SF 3");
    expect(matchLabel("f", 1)).toBe("Final 1");
    expect(matchLabel("ef", 4)).toBe("EF 4");
  });
});
