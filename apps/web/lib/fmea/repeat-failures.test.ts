import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPEAT_THRESHOLD,
  detectRepeatFailures,
  detectRepeatFailuresFromPitLog,
  formatRepeatFailureMessage,
} from "./repeat-failures";
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

describe("formatRepeatFailureMessage", () => {
  it("names the subsystem and count", () => {
    expect(formatRepeatFailureMessage({ subsystemName: "Intake", failureCount: 4, seasonYear: 2026 })).toBe(
      "Intake has failed 4 times this season (2026)",
    );
  });
});

describe("detectRepeatFailures", () => {
  it("stays quiet below the threshold", () => {
    expect(detectRepeatFailures([failure(), failure({ subsystemName: "Elevator" })])).toEqual([]);
    expect(DEFAULT_REPEAT_THRESHOLD).toBe(2);
  });

  it("flags a subsystem that fails repeatedly this season", () => {
    const alerts = detectRepeatFailures(
      [
        failure({ title: "Belt slip QM1" }),
        failure({ title: "Belt slip QM3", status: "closed" }),
        failure({ title: "Jam again", occurrence: 6, severity: 7, detection: 5 }),
        failure({ subsystemName: "Elevator", title: "Once" }),
      ],
      { seasonYear: 2026 },
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.subsystemName).toBe("Intake");
    expect(alerts[0]?.failureCount).toBe(3);
    expect(alerts[0]?.openCount).toBe(2);
    expect(alerts[0]?.message).toContain("Intake has failed 3 times");
    expect(alerts[0]?.href).toBe("/fmea");
    expect(alerts[0]?.maxRpn).toBe(210);
  });

  it("respects a higher threshold", () => {
    const alerts = detectRepeatFailures([failure(), failure(), failure()], { threshold: 4 });
    expect(alerts).toEqual([]);
  });
});

describe("detectRepeatFailuresFromPitLog", () => {
  it("aggregates robot_failures by subsystem", () => {
    const alerts = detectRepeatFailuresFromPitLog(
      [
        { subsystem: "Drivetrain", severity: "disabled", symptoms: "Chain jumped", occurredAt: "2026-03-01" },
        { subsystem: "Drivetrain", severity: "degraded", symptoms: "Left side slow", occurredAt: "2026-03-02" },
        { subsystem: "Intake", severity: "minor", symptoms: "Once", occurredAt: "2026-03-02" },
      ],
      { seasonYear: 2026 },
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.subsystemName).toBe("Drivetrain");
    expect(alerts[0]?.failureCount).toBe(2);
    expect(alerts[0]?.href).toBe("/pit");
  });
});
