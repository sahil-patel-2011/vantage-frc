import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@vantage/scouting";
import { REBUILT_2026 } from "@vantage/game-year";
import { matchCapture, validateMatchCapture } from "@vantage/scouting";
import { timingForSeason } from "./match-clock";
import {
  answerText,
  fieldsForQuickStage,
  optionLabel,
  pushUndo,
  quickFieldStages,
  quickTileKind,
  scheduleAnswers,
  stageForClock,
  stagesWithFields,
  stepCounter,
  stopCaptureAction,
  toggleCaptureAction,
  uncountedFields,
  voidCaptureAction,
} from "./quick-scout";

const rebuilt = REBUILT_2026.matchSchema.fields as FieldDefinition[];
const keys = (fields: FieldDefinition[]) => fields.map((field) => field.key);

describe("quick scout stages", () => {
  it("splits the 2026 starter form into the stages a scout watches", () => {
    expect(keys(fieldsForQuickStage(rebuilt, "pre"))).toEqual(["alliance_station"]);
    expect(keys(fieldsForQuickStage(rebuilt, "auto"))).toEqual(["auto_fuel", "auto_tower_level"]);
    expect(keys(fieldsForQuickStage(rebuilt, "teleop"))).toEqual(["teleop_fuel", "fuel_passed", "trench", "bump"]);
    expect(keys(fieldsForQuickStage(rebuilt, "review"))).toEqual(["disabled", "shooting_moving", "shooting_accuracy", "defense_effectiveness", "notes"]);
  });

  it("keeps scoring on the endgame screen under the climb", () => {
    expect(keys(fieldsForQuickStage(rebuilt, "endgame"))).toEqual([
      "tower_level",
      "teleop_fuel",
      "fuel_passed",
      "trench",
      "bump",
    ]);
  });

  it("puts every answerable question in exactly one stage and skips section headers", () => {
    const fields: FieldDefinition[] = [
      { key: "autoHeader", label: "Autonomous", type: "section_header" },
      { key: "leave", label: "Left the line", type: "boolean" },
      { key: "mystery", label: "Custom action", type: "counter" },
      { key: "story", label: "What happened", type: "long_text" },
    ];
    const stages = quickFieldStages(fields);
    expect(stages.has("autoHeader")).toBe(false);
    expect(stages.get("leave")).toBe("auto");
    expect(stages.get("mystery")).toBe("auto");
    const loose: FieldDefinition[] = [
      { key: "mystery", label: "Custom action", type: "counter" },
      { key: "story", label: "What happened", type: "long_text" },
    ];
    expect(quickFieldStages(loose).get("mystery")).toBe("teleop");
    expect(quickFieldStages(loose).get("story")).toBe("review");
  });

  it("only lists live stages a form has questions for", () => {
    expect(stagesWithFields(rebuilt)).toEqual(["pre", "auto", "teleop", "endgame", "review"]);
    expect(stagesWithFields([{ key: "notes", label: "Notes", type: "text" }])).toEqual(["pre", "review"]);
  });

  it("follows the 2026 clock, keeping the scoring pause on auto", () => {
    const timing = timingForSeason(2026);
    expect(stageForClock(null, timing)).toBe("pre");
    expect(stageForClock(5_000, timing)).toBe("auto");
    expect(stageForClock(21_000, timing)).toBe("auto");
    expect(stageForClock(40_000, timing)).toBe("teleop");
    expect(stageForClock(140_000, timing)).toBe("endgame");
    expect(stageForClock(163_000, timing)).toBe("review");
  });
});

describe("quick scout tiles", () => {
  it("picks the biggest control a question allows", () => {
    expect(quickTileKind({ key: "auto_fuel", label: "Auto fuel scored", type: "number" })).toBe("counter");
    expect(quickTileKind({ key: "cycle_time", label: "Cycle time", type: "number" })).toBe("detail");
    expect(quickTileKind({ key: "x", label: "X", type: "counter" })).toBe("counter");
    expect(quickTileKind({ key: "b", label: "B", type: "boolean" })).toBe("toggle");
    expect(quickTileKind({ key: "c", label: "C", type: "select", options: ["none", "L1", "L2", "L3"] })).toBe("choice");
    expect(quickTileKind({ key: "m", label: "M", type: "multiple_choice", options: ["a", "b"], config: { allowMultiple: true } })).toBe("detail");
    expect(quickTileKind({ key: "s", label: "S", type: "select", options: ["1", "2", "3", "4", "5", "6", "7"] })).toBe("detail");
    expect(quickTileKind({ key: "n", label: "Notes", type: "text" })).toBe("detail");
  });

  it("keeps blank (not counted) apart from an observed zero", () => {
    const fuel = rebuilt.find((field) => field.key === "auto_fuel")!;
    expect(stepCounter(fuel, undefined, 1)).toBe(1);
    expect(stepCounter(fuel, undefined, -1)).toBeUndefined();
    expect(stepCounter(fuel, 1, -1)).toBe(0);
    expect(stepCounter(fuel, 0, -1)).toBeUndefined();
    expect(stepCounter(fuel, 4, 5)).toBe(9);
  });

  it("respects a counter's own steps and ceiling", () => {
    const capped: FieldDefinition = { key: "c", label: "C", type: "counter", config: { max: 3 } };
    expect(stepCounter(capped, 2, 5)).toBe(3);
    expect(stepCounter(capped, undefined, 1)).toBe(1);
    const numberCapped: FieldDefinition = { key: "n", label: "Gamepieces", type: "number", config: { max: 2 } };
    expect(stepCounter(numberCapped, 2, 1)).toBe(2);
  });

  it("names uncounted required observations so the scout can mark a zero", () => {
    expect(keys(uncountedFields(rebuilt, { auto_fuel: 3 }))).toEqual(["teleop_fuel", "fuel_passed"]);
    expect(keys(uncountedFields(rebuilt, { auto_fuel: 0, teleop_fuel: 0, fuel_passed: 0 }))).toEqual([]);
  });

  it("fills the seat from the schedule, never over the scout's answer", () => {
    const station = { alliance: "red" as const, station: 2 as const };
    expect(scheduleAnswers(rebuilt, {}, station)).toEqual({ alliance_station: "red2" });
    expect(scheduleAnswers(rebuilt, { alliance_station: "blue1" }, station)).toEqual({});
    expect(scheduleAnswers(rebuilt, {}, null)).toEqual({});
    const spaced: FieldDefinition[] = [{ key: "alliance_station", label: "Station", type: "select", options: ["Red 1", "Red 2", "Blue 1"] }];
    expect(scheduleAnswers(spaced, {}, station)).toEqual({ alliance_station: "Red 2" });
  });

  it("reads options and answers as words", () => {
    expect(optionLabel("mostly_hit")).toBe("Mostly hit");
    expect(optionLabel("L2")).toBe("L2");
    expect(optionLabel("red2")).toBe("Red 2");
    const level = rebuilt.find((field) => field.key === "tower_level")!;
    expect(answerText(level, "l3")).toBe("L3");
    expect(answerText(level, undefined)).toBe("—");
    expect(answerText({ key: "b", label: "B", type: "boolean" }, false)).toBe("No");
  });
});

describe("quick scout timed actions", () => {
  const clock = 1_700_000_000_000;

  it("starts, switches and stops one action at a time", () => {
    let payload: Record<string, unknown> = {};
    let result = toggleCaptureAction(payload, { kind: "shooting", id: "a", elapsedMs: 30_000, clockStartedAt: clock });
    expect(result.started).toBe("a");
    payload = result.payload;
    result = toggleCaptureAction(payload, { kind: "defending", id: "b", elapsedMs: 34_000, clockStartedAt: clock });
    payload = result.payload;
    const bouts = matchCapture(payload)!.bouts;
    expect(bouts.map((bout) => [bout.kind, bout.startMs, bout.endMs])).toEqual([
      ["shooting", 30_000, 34_000],
      ["defending", 34_000, null],
    ]);
    result = toggleCaptureAction(payload, { kind: "defending", id: "c", elapsedMs: 40_000, clockStartedAt: clock });
    expect(result.started).toBeNull();
    expect(validateMatchCapture(result.payload._match_capture)).toEqual([]);
  });

  it("voids an action stopped the instant it started instead of failing", () => {
    const first = toggleCaptureAction({}, { kind: "feeding", id: "a", elapsedMs: 50_000, clockStartedAt: clock });
    const stopped = toggleCaptureAction(first.payload, { kind: "feeding", id: "b", elapsedMs: 50_000, clockStartedAt: clock });
    expect(matchCapture(stopped.payload)!.bouts[0]!.voided).toBe(true);
    expect(validateMatchCapture(stopped.payload._match_capture)).toEqual([]);
  });

  it("stops at the buzzer and undoes by voiding", () => {
    const running = toggleCaptureAction({}, { kind: "shooting", id: "a", elapsedMs: 150_000, clockStartedAt: clock }).payload;
    const stopped = stopCaptureAction(running, 200_000);
    expect(matchCapture(stopped)!.bouts[0]!.endMs).toBe(163_000);
    const undone = voidCaptureAction(stopped, "a");
    expect(matchCapture(undone)!.bouts[0]!.voided).toBe(true);
    expect(voidCaptureAction(undone, "a")).toBe(undone);
    expect(toggleCaptureAction({}, { kind: "shooting", id: "z", elapsedMs: 170_000, clockStartedAt: clock }).started).toBeNull();
  });

  it("caps the undo stack", () => {
    let stack = pushUndo([], { kind: "answer" }, 3);
    for (let index = 0; index < 5; index++) stack = pushUndo(stack, { kind: "action", id: String(index) }, 3);
    expect(stack).toEqual([
      { kind: "action", id: "2" },
      { kind: "action", id: "3" },
      { kind: "action", id: "4" },
    ]);
  });
});
