import { describe, expect, it } from "vitest";
import { validatePayload, type FieldDefinition } from "@vantage/scouting";
import { answersToSave } from "./entry-answers";

describe("saving observed scouting answers", () => {
  const fields: FieldDefinition[] = [{ key: "fuel", label: "Fuel", type: "number", required: true }];
  it("keeps an untouched required counter unanswered even on older forms", () => {
    const answers = answersToSave(fields, {});
    expect(answers).toEqual({});
    expect(validatePayload({ title: "Match", fields }, answers)).toEqual(["Fuel is required"]);
  });
  it("preserves an explicitly recorded zero and a cleared answer stays unanswered", () => {
    expect(answersToSave(fields, { fuel: 0 })).toEqual({ fuel: 0 });
    expect(validatePayload({ title: "Match", fields }, answersToSave(fields, { fuel: 0 }))).toEqual([]);
    expect(validatePayload({ title: "Match", fields }, answersToSave(fields, { fuel: undefined }))).toEqual(["Fuel is required"]);
  });
  it("removes hidden answers without requiring them on the server", () => {
    const conditional: FieldDefinition[] = [
      { key: "attempted", label: "Attempted", type: "boolean" },
      { key: "climb_time", label: "Climb time", type: "number", required: true, config: { visibleWhen: { fieldKey: "attempted", isTrue: true } } },
    ];
    const definition = { title: "Climb", fields: conditional };
    const answers = answersToSave(conditional, { attempted: false, climb_time: 10 });
    expect(answers).toEqual({ attempted: false });
    expect(validatePayload(definition, answers)).toEqual([]);
    expect(validatePayload(definition, { attempted: true })).toEqual(["Climb time is required"]);
    expect(validatePayload(definition, { attempted: false, climb_time: 10 })).toEqual(["Climb time is hidden by this form's answer rules"]);
  });
  it("uses the same inferred phase rules during projection and server validation", () => {
    const phased: FieldDefinition[] = [
      { key: "game_phase", label: "Phase", type: "select", options: ["auto", "teleop", "endgame"] },
      { key: "auto_fuel", label: "Auto fuel", type: "number", required: true },
      { key: "teleop_fuel", label: "Teleop fuel", type: "number", required: true },
    ];
    const answers = answersToSave(phased, { game_phase: "auto", auto_fuel: 0, teleop_fuel: 2 });
    expect(answers).toEqual({ game_phase: "auto", auto_fuel: 0 });
    expect(validatePayload({ title: "Match", fields: phased }, answers)).toEqual([]);
  });
});
