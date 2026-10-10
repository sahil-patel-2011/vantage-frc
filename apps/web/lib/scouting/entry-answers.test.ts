import { describe, expect, it } from "vitest";
import { applyMultiCounterStep, multiCounterConfig, validatePayload, type FieldDefinition } from "@vantage/scouting";
import { answersToSave } from "./entry-answers";

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
