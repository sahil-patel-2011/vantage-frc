import { describe, expect, it } from "vitest";
import { isVisibleWhen, readVisibleWhen, stripHiddenAnswers, visibleWhenMatches, visibleFields, withInferredPhaseRules } from "./visibility";
import { validatePayload, type SchemaDefinition } from "./index";

describe("shared conditional scouting rules", () => {
  it("does not treat an unanswered comparison as a negative answer", () => {
    const rule = { fieldKey: "climb", notEquals: "none" };
    expect(visibleWhenMatches(rule, {})).toBe(false);
    expect(visibleWhenMatches(rule, { climb: "none" })).toBe(false);
    expect(visibleWhenMatches(rule, { climb: "level1" })).toBe(true);
  });
  it("hides chained dependants and removes their stale answers regardless of field order", () => {
    const fields = [
      { key: "seconds", visibleWhen: { fieldKey: "level", equals: "high" } },
      { key: "level", visibleWhen: { fieldKey: "attempted", isTrue: true } },
      { key: "attempted" },
    ];
    const answers = { attempted: false, level: "high", seconds: 7 };
    expect(visibleFields(fields, answers).map(field => field.key)).toEqual(["attempted"]);
    expect(stripHiddenAnswers(fields, answers)).toEqual({ attempted: false });
    expect(visibleFields(fields, { ...answers, attempted: true })).toHaveLength(3);
  });
  it("keeps an alternate visible condition usable and closes legacy cycles", () => {
    const fields = [
      { key: "a", visibleWhen: { fieldKey: "b", isSet: true } },
      { key: "b", visibleWhen: { fieldKey: "a", isSet: true } },
      { key: "other" },
      { key: "notes", visibleWhen: { anyOf: [{ fieldKey: "a", isSet: true }, { fieldKey: "other", isTrue: true }] } },
    ];
    expect(visibleFields(fields, { a: "old", b: "old", other: true }).map(field => field.key)).toEqual(["other", "notes"]);
  });
  it("validates chained questions with the same reachability as the entry form", () => {
    const schema: SchemaDefinition = { title: "Climb", fields: [
      { key: "attempted", label: "Attempted", type: "boolean" },
      { key: "level", label: "Level", type: "text", required: true, visibleWhen: { fieldKey: "attempted", isTrue: true } },
      { key: "seconds", label: "Seconds", type: "number", required: true, visibleWhen: { fieldKey: "level", equals: "high" } },
    ] };
    expect(validatePayload(schema, { attempted: false })).toEqual([]);
    expect(validatePayload(schema, { attempted: false, level: "high", seconds: 7 })).toEqual(["Level is hidden by this form's answer rules", "Seconds is hidden by this form's answer rules"]);
    expect(validatePayload(schema, { attempted: true, level: "high" })).toEqual(["Seconds is required"]);
  });
  it.each([false, 3, "auto", [], {}, { fieldKey: "x" }, { allOf: [] }, { anyOf: [null] },
    { allOf: [{ fieldKey: "x", isTrue: "yes" }] }, { fieldKey: "x", oneOf: "yes" },
    { fieldKey: "x", gte: Infinity }, { fieldKey: "x", equals: {} },
  ])("rejects malformed persisted rules safely: %j", rule => {
    expect(isVisibleWhen(rule)).toBe(false);
    expect(visibleWhenMatches(readVisibleWhen({ config: { visibleWhen: rule } }), { x: true })).toBe(false);
  });
  it("matches finite ranges and nested all/any clauses using recorded answers", () => {
    const rule = { allOf: [{ fieldKey: "attempted", isTrue: true }, { fieldKey: "seconds", gte: 0, lte: 20 }] };
    expect(isVisibleWhen(rule)).toBe(true);
    expect(visibleWhenMatches(rule, { attempted: true, seconds: 0 })).toBe(true);
    expect(visibleWhenMatches(rule, { attempted: true })).toBe(false);
    expect(visibleWhenMatches(rule, { attempted: false, seconds: 10 })).toBe(false);
  });
  it("requires only reachable answers and rejects stale hidden values", () => {
    const schema: SchemaDefinition = { title: "Match", fields: [
      { key: "attempted", label: "Attempted", type: "boolean", required: true },
      { key: "seconds", label: "Seconds", type: "number", required: true, config: { visibleWhen: { fieldKey: "attempted", isTrue: true } } },
    ] };
    expect(validatePayload(schema, { attempted: false })).toEqual([]);
    expect(validatePayload(schema, { attempted: true })).toEqual(["Seconds is required"]);
    expect(validatePayload(schema, { attempted: true, seconds: 0 })).toEqual([]);
    expect(validatePayload(schema, { attempted: false, seconds: 0 })).toEqual(["Seconds is hidden by this form's answer rules"]);
  });
  it("keeps defense controllers reachable and does not invent missing controllers", () => {
    const fields = withInferredPhaseRules([
      { key: "gamePhase", label: "Phase" }, { key: "playingDefense", label: "Playing defense" },
      { key: "defenseTime", label: "Defense time" },
    ]);
    expect(visibleFields(fields, { gamePhase: "teleop" }).map(field => field.key)).toEqual(["gamePhase", "playingDefense"]);
    expect(visibleFields(fields, { gamePhase: "teleop", playingDefense: true }).map(field => field.key)).toEqual(["gamePhase", "playingDefense", "defenseTime"]);
    const withoutController = withInferredPhaseRules([{ key: "gamePhase" }, { key: "defenseTime" }]);
    expect(visibleFields(withoutController, { gamePhase: "teleop" }).map(field => field.key)).toEqual(["gamePhase", "defenseTime"]);
  });
});
