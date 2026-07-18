import { describe, expect, it } from "vitest";
import { parseAutoRoutineAction, summarizeRoutines, validateRoutine } from "./auto-routines";

describe("validateRoutine", () => {
  it("requires a name", () => {
    expect(validateRoutine({ startPosition: "left" }).ok).toBe(false);
  });
  it("rejects invalid enums", () => {
    expect(validateRoutine({ name: "Two note", startPosition: "north" }).ok).toBe(false);
    expect(validateRoutine({ name: "Two note", status: "magic" }).ok).toBe(false);
  });
  it("rejects negative estimated points", () => {
    expect(validateRoutine({ name: "Two note", estimatedPoints: -4 }).ok).toBe(false);
  });
  it("defaults status to concept and priority to normal", () => {
    const result = validateRoutine({ name: "Two note" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("concept");
      expect(result.value.priority).toBe("normal");
    }
  });
});

describe("summarizeRoutines", () => {
  it("reports readiness, covered start positions, and unproven high-priority autos", () => {
    const summary = summarizeRoutines([
      { status: "competition_ready", priority: "high", startPosition: "left", estimatedPoints: 15 },
      { status: "competition_ready", priority: "normal", startPosition: "center", estimatedPoints: 20 },
      { status: "coding", priority: "high", startPosition: "right", estimatedPoints: 25 },
      { status: "retired", priority: "low", startPosition: "left", estimatedPoints: 5 },
    ]);
    expect(summary.total).toBe(3); // retired excluded
    expect(summary.ready).toBe(2);
    expect(summary.coveredStartPositions.sort()).toEqual(["center", "left"]);
    expect(summary.highPriorityUnproven).toBe(1); // the coding one
    expect(summary.bestReadyPoints).toBe(20);
  });
  it("reports null best points when nothing is ready", () => {
    expect(summarizeRoutines([{ status: "concept", priority: "low", startPosition: "center", estimatedPoints: null }]).bestReadyPoints).toBeNull();
  });
});

describe("parseAutoRoutineAction", () => {
  it("parses create_routine with a season year", () => {
    const action = parseAutoRoutineAction({ action: "create_routine", orgId: "o1", seasonYear: 2026, name: "Two note", startPosition: "center" });
    expect(action).toMatchObject({ action: "create_routine", name: "Two note" });
  });
  it("rejects create_routine without season year", () => {
    expect(() => parseAutoRoutineAction({ action: "create_routine", orgId: "o1", name: "Two note" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseAutoRoutineAction({ action: "launch", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
