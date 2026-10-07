import { describe, expect, it } from "vitest";
import { isVisibleWhen, readVisibleWhen, visibleWhenMatches, visibleFields, withInferredPhaseRules } from "./visibility";
import { validatePayload, type SchemaDefinition } from "./index";

describe("shared conditional scouting rules", () => {
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
