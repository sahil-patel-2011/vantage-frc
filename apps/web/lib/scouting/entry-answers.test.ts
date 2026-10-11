import { describe, expect, it } from "vitest";
import { applyMultiCounterStep, multiCounterConfig, validatePayload, type FieldDefinition } from "@vantage/scouting";
import { answersToSave, hasObservation } from "./entry-answers";

describe("hasObservation", () => {
  it("is false for a report with nothing in it, or only the seat the schedule filled in", () => {
    expect(hasObservation({})).toBe(false);
    expect(hasObservation(null)).toBe(false);
    expect(hasObservation({ alliance_station: "Red 1" })).toBe(false);
    expect(hasObservation({ notes: "   ", drivetrain: "", tags: [], counts: {} })).toBe(false);
    expect(hasObservation({ _observations: { version: 1, events: [] }, _match_capture: { bouts: [] } })).toBe(false);
  });

  it("counts a zero, a No, a choice and a timed action as something the scout saw", () => {
    expect(hasObservation({ auto_points: 0 })).toBe(true);
    expect(hasObservation({ climbed: false })).toBe(true);
    expect(hasObservation({ drivetrain: "swerve" })).toBe(true);
    expect(hasObservation({ _match_capture: { bouts: [{ id: "a", kind: "shooting", startMs: 0, endMs: 3000, count: null }] } })).toBe(true);
    expect(hasObservation({ _match_capture: { bouts: [{ id: "a", kind: "shooting", startMs: 0, endMs: 3000, count: null, voided: true }] } })).toBe(false);
  });
});

describe("observed scouting answers", () => {
  const count: FieldDefinition = { key: "fuel", label: "Fuel", type: "counter", required: true };
  it("keeps an unobserved required counter blank and asks for an answer", () => {
    const payload = answersToSave([count], {});
    expect(payload).toEqual({});
    expect(validatePayload({ title: "Match", fields: [count] }, payload)).toEqual(["Fuel is required"]);
    expect(validatePayload({ title: "Match", fields: [count] }, answersToSave([count], { fuel: 0 }))).toEqual([]);
  });
  it("does not manufacture the other observations when a scout counts one kind of action", () => {
    const config = multiCounterConfig({ config: { counters: [{ key: "scored", label: "Scored" }, { key: "passed", label: "Passed" }] } });
    expect(applyMultiCounterStep(undefined, "scored", 1, config)).toEqual({ scored: 1 });
    expect(applyMultiCounterStep({ scored: 2, passed: 0 }, "scored", 1, config)).toEqual({ scored: 3, passed: 0 });
  });
  it("removes stale dependent answers after the controller stops matching", () => {
    const fields: FieldDefinition[] = [
      { key: "attempted", label: "Climb attempted", type: "boolean" },
      { key: "level", label: "Level", type: "text", required: true, visibleWhen: { fieldKey: "attempted", isTrue: true } },
    ];
    expect(answersToSave(fields, { attempted: false, level: "high" })).toEqual({ attempted: false });
  });
});
