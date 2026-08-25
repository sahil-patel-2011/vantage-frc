import { describe, expect, it } from "vitest";
import {
  accumulateTimerLaps,
  applyCounterStep,
  applyFormResetBehavior,
  applyMultiCounterStep,
  answerableFields,
  counterConfig,
  detectDisagreements,
  fieldPositionCellLabel,
  fieldPositionConfig,
  fieldResetBehavior,
  incrementValue,
  isSliderValueAligned,
  multiCounterConfig,
  multiCounterTotal,
  normalizeFieldPositionCells,
  normalizeTimerLaps,
  ratingConfig,
  sliderConfig,
  snapSliderValue,
  timerAverageLapSeconds,
  timerConfig,
  timerTotalSeconds,
  toggleFieldPositionCell,
  toggleRatingValue,
  validatePayload,
  type FieldDefinition,
  type SchemaDefinition,
} from "../src";

function schemaOf(...fields: FieldDefinition[]): SchemaDefinition {
  return { title: "Studio form", fields };
}

const counterField: FieldDefinition = {
  key: "cycles",
  label: "Cycles",
  type: "counter",
  config: { steps: [1, 5, 10], max: 30 },
};

const multiCounterField: FieldDefinition = {
  key: "scoring",
  label: "Scoring",
  type: "multi_counter",
  config: {
    steps: [1, 5],
    max: 20,
    counters: [
      { key: "high", label: "High" },
      { key: "low", label: "Low" },
    ],
  },
};

const lapTimerField: FieldDefinition = {
  key: "cycle_time",
  label: "Cycle time",
  type: "timer",
  config: { mode: "lap", maxSeconds: 150 },
};

const totalTimerField: FieldDefinition = {
  key: "defense_time",
  label: "Defense time",
  type: "timer",
  config: { mode: "total", maxSeconds: 150 },
};

const ratingField: FieldDefinition = {
  key: "driver_skill",
  label: "Driver skill",
  type: "rating",
  config: { max: 5 },
};

const multiSelectField: FieldDefinition = {
  key: "capabilities",
  label: "Capabilities",
  type: "multi_select",
  options: ["climb", "defense", "intake_ground"],
};

const sliderField: FieldDefinition = {
  key: "aggression",
  label: "Aggression",
  type: "slider",
  config: { min: 0, max: 10, step: 2, labels: { min: "Passive", max: "Relentless" } },
};

const sectionField: FieldDefinition = {
  key: "auto_section",
  label: "Auto",
  type: "section_header",
};

const positionField: FieldDefinition = {
  key: "scoring_spots",
  label: "Scoring spots",
  type: "field_position",
  config: { gridCols: 4, gridRows: 3 },
};

describe("counter field", () => {
  it("accepts in-range whole numbers and rejects out-of-range or wrong shapes", () => {
    expect(validatePayload(schemaOf(counterField), { cycles: 0 })).toEqual([]);
    expect(validatePayload(schemaOf(counterField), { cycles: 30 })).toEqual([]);
    expect(validatePayload(schemaOf(counterField), { cycles: 31 })).toEqual([
      "Cycles must be at most 30",
    ]);
    expect(validatePayload(schemaOf(counterField), { cycles: -1 })).toEqual([
      "Cycles cannot go below zero",
    ]);
    expect(validatePayload(schemaOf(counterField), { cycles: 2.5 })).toEqual([
      "Cycles must be a whole number",
    ]);
    expect(validatePayload(schemaOf(counterField), { cycles: "3" })).toEqual([
      "Cycles must be a whole number",
    ]);
  });

  it("allows negatives only when configured", () => {
    const negatives: FieldDefinition = {
      ...counterField,
      config: { steps: [1], allowNegative: true, min: -5 },
    };
    expect(validatePayload(schemaOf(negatives), { cycles: -4 })).toEqual([]);
    expect(validatePayload(schemaOf(negatives), { cycles: -6 })).toEqual([
      "Cycles must be at least -5",
    ]);
  });

  it("does counter math with bulk steps and clamps at the cap", () => {
    const config = counterConfig(counterField);
    expect(config.steps).toEqual([1, 5, 10]);
    expect(applyCounterStep(undefined, 1, config)).toBe(1);
    expect(applyCounterStep(4, 5, config)).toBe(9);
    expect(applyCounterStep(9, 10, config)).toBe(19);
    // Bulk taps clamp at max instead of overshooting.
    expect(applyCounterStep(25, 10, config)).toBe(30);
    // Undo (the minus tap) never falls below zero unless negatives are allowed.
    expect(applyCounterStep(3, -5, config)).toBe(0);
  });

  it("defaults to +1 / +5 / +10 when steps are missing or junk", () => {
    expect(counterConfig({ config: undefined }).steps).toEqual([1, 5, 10]);
    expect(counterConfig({ config: { steps: ["x", -2, 0] } }).steps).toEqual([1, 5, 10]);
    expect(counterConfig({ config: { steps: [10, 1, 1, 5] } }).steps).toEqual([1, 5, 10]);
  });
});

describe("multi counter field", () => {
  it("rejects unknown sub-counters, wrong shapes, and out-of-range counts", () => {
    expect(validatePayload(schemaOf(multiCounterField), { scoring: { high: 4, low: 2 } })).toEqual([]);
    expect(validatePayload(schemaOf(multiCounterField), { scoring: { high: 4, mid: 2 } })).toEqual([
      "Scoring has an unknown counter: mid",
    ]);
    expect(validatePayload(schemaOf(multiCounterField), { scoring: { high: 21 } })).toEqual([
      "Scoring · high must be at most 20",
    ]);
    expect(validatePayload(schemaOf(multiCounterField), { scoring: { high: -1 } })).toEqual([
      "Scoring · high cannot go below zero",
    ]);
    expect(validatePayload(schemaOf(multiCounterField), { scoring: [1, 2] })).toEqual([
      "Scoring must be a set of named counts",
    ]);
  });

  it("treats an all-empty bag as empty for required checks", () => {
    const required = { ...multiCounterField, required: true };
    expect(validatePayload(schemaOf(required), { scoring: {} })).toEqual(["Scoring is required"]);
  });

  it("steps one named counter at a time and totals the block", () => {
    const config = multiCounterConfig(multiCounterField);
    expect(config.counters.map((counter) => counter.key)).toEqual(["high", "low"]);
    const first = applyMultiCounterStep({}, "high", 5, config);
    expect(first).toEqual({ high: 5, low: 0 });
    const second = applyMultiCounterStep(first, "low", 1, config);
    expect(second).toEqual({ high: 5, low: 1 });
    // Unknown keys are ignored rather than silently created.
    expect(applyMultiCounterStep(second, "mid", 5, config)).toEqual({ high: 5, low: 1 });
    expect(multiCounterTotal(second, config)).toBe(6);
  });
});

describe("timer field", () => {
  it("validates lap lists and total seconds separately", () => {
    expect(validatePayload(schemaOf(lapTimerField), { cycle_time: [4.2, 5.1] })).toEqual([]);
    expect(validatePayload(schemaOf(lapTimerField), { cycle_time: 12 })).toEqual([
      "Cycle time must be a list of lap times in seconds",
    ]);
    expect(validatePayload(schemaOf(lapTimerField), { cycle_time: [4.2, -1] })).toEqual([
      "Cycle time has a lap that is not a number of seconds",
    ]);
    expect(validatePayload(schemaOf(lapTimerField), { cycle_time: [100, 60] })).toEqual([
      "Cycle time totals more than 150s",
    ]);
    expect(validatePayload(schemaOf(totalTimerField), { defense_time: 42.5 })).toEqual([]);
    expect(validatePayload(schemaOf(totalTimerField), { defense_time: [1, 2] })).toEqual([
      "Defense time must be a number of seconds",
    ]);
    expect(validatePayload(schemaOf(totalTimerField), { defense_time: 151 })).toEqual([
      "Defense time must be at most 150s",
    ]);
  });

  it("accumulates laps without float noise and averages them", () => {
    expect(timerConfig(lapTimerField).mode).toBe("lap");
    expect(accumulateTimerLaps([0.1, 0.2])).toBe(0.3);
    expect(accumulateTimerLaps([4.25, 5.5, 3.125])).toBe(12.875);
    expect(accumulateTimerLaps([])).toBe(0);
    expect(normalizeTimerLaps([1, "x", -2, 3])).toEqual([1, 3]);
    expect(timerTotalSeconds([1.5, 2.5], timerConfig(lapTimerField))).toBe(4);
    expect(timerTotalSeconds(9.25, timerConfig(totalTimerField))).toBe(9.25);
    expect(timerAverageLapSeconds([2, 4])).toBe(3);
    expect(timerAverageLapSeconds([])).toBeNull();
  });
});

describe("rating field", () => {
  it("accepts 1..max and rejects anything outside", () => {
    expect(validatePayload(schemaOf(ratingField), { driver_skill: 5 })).toEqual([]);
    expect(validatePayload(schemaOf(ratingField), { driver_skill: 6 })).toEqual([
      "Driver skill must be between 1 and 5",
    ]);
    expect(validatePayload(schemaOf(ratingField), { driver_skill: 0 })).toEqual([
      "Driver skill must be between 1 and 5",
    ]);
    expect(validatePayload(schemaOf(ratingField), { driver_skill: "great" })).toEqual([
      "Driver skill must be a whole-number rating",
    ]);
  });

  it("clamps a nonsense configured max and toggles a star off", () => {
    expect(ratingConfig({ config: { max: 99 } }).max).toBe(10);
    expect(ratingConfig({ config: {} }).max).toBe(5);
    const config = ratingConfig(ratingField);
    expect(toggleRatingValue(undefined, 4, config)).toBe(4);
    expect(toggleRatingValue(4, 4, config)).toBeUndefined();
    expect(toggleRatingValue(4, 9, config)).toBe(5);
  });
});

describe("multi select field", () => {
  it("requires a real list of known, distinct options", () => {
    expect(validatePayload(schemaOf(multiSelectField), { capabilities: ["climb", "defense"] })).toEqual(
      [],
    );
    expect(validatePayload(schemaOf(multiSelectField), { capabilities: "climb" })).toEqual([
      "Capabilities must be a list of options",
    ]);
    expect(validatePayload(schemaOf(multiSelectField), { capabilities: ["climb", "climb"] })).toEqual([
      "Capabilities has a duplicate option",
    ]);
    expect(validatePayload(schemaOf(multiSelectField), { capabilities: ["hover"] })).toEqual([
      "Capabilities has an invalid option",
    ]);
  });
});

describe("slider field", () => {
  it("checks range and step alignment", () => {
    expect(validatePayload(schemaOf(sliderField), { aggression: 4 })).toEqual([]);
    expect(validatePayload(schemaOf(sliderField), { aggression: 11 })).toEqual([
      "Aggression must be between 0 and 10",
    ]);
    expect(validatePayload(schemaOf(sliderField), { aggression: 3 })).toEqual([
      "Aggression must land on a step of 2",
    ]);
    expect(validatePayload(schemaOf(sliderField), { aggression: "high" })).toEqual([
      "Aggression must be a number",
    ]);
  });

  it("repairs an impossible config and snaps values", () => {
    const config = sliderConfig({ config: { min: 5, max: 1, step: 0 } });
    expect(config.max).toBeGreaterThan(config.min);
    expect(config.step).toBeGreaterThan(0);
    const real = sliderConfig(sliderField);
    expect(real.minLabel).toBe("Passive");
    expect(isSliderValueAligned(6, real)).toBe(true);
    expect(isSliderValueAligned(5, real)).toBe(false);
    expect(snapSliderValue(5, real)).toBe(6);
    expect(snapSliderValue(99, real)).toBe(10);
  });
});

describe("section header field", () => {
  it("stores nothing and never gates a save", () => {
    expect(validatePayload(schemaOf(sectionField, counterField), { cycles: 2 })).toEqual([]);
    expect(
      validatePayload(schemaOf({ ...sectionField, required: true }, counterField), { cycles: 2 }),
    ).toEqual([]);
    expect(validatePayload(schemaOf(sectionField), { auto_section: "anything" })).toEqual([
      "Auto is a section header and stores no answer",
    ]);
  });

  it("is excluded from the answerable field list", () => {
    expect(answerableFields(schemaOf(sectionField, counterField)).map((f) => f.key)).toEqual([
      "cycles",
    ]);
  });
});

describe("field position field", () => {
  it("accepts in-grid cell indices and rejects everything else", () => {
    expect(validatePayload(schemaOf(positionField), { scoring_spots: [0, 5, 11] })).toEqual([]);
    expect(validatePayload(schemaOf(positionField), { scoring_spots: [12] })).toEqual([
      "Scoring spots has a cell outside the 4×3 grid",
    ]);
    expect(validatePayload(schemaOf(positionField), { scoring_spots: [-1] })).toEqual([
      "Scoring spots has a cell outside the 4×3 grid",
    ]);
    expect(validatePayload(schemaOf(positionField), { scoring_spots: [1, 1] })).toEqual([
      "Scoring spots has a duplicate cell",
    ]);
    expect(validatePayload(schemaOf(positionField), { scoring_spots: { x: 1, y: 2 } })).toEqual([
      "Scoring spots must be a list of grid cells",
    ]);
    expect(validatePayload(schemaOf(positionField), { scoring_spots: ["a1"] })).toEqual([
      "Scoring spots has a cell outside the 4×3 grid",
    ]);
  });

  it("honours an allowedCells whitelist", () => {
    const restricted: FieldDefinition = {
      ...positionField,
      config: { gridCols: 4, gridRows: 3, allowedCells: [0, 1, 2] },
    };
    expect(validatePayload(schemaOf(restricted), { scoring_spots: [1] })).toEqual([]);
    expect(validatePayload(schemaOf(restricted), { scoring_spots: [7] })).toEqual([
      "Scoring spots has a cell that is not selectable on this form",
    ]);
  });

  it("labels cells column-letter + row-number and toggles taps", () => {
    const config = fieldPositionConfig(positionField);
    expect(fieldPositionCellLabel(0, config)).toBe("A1");
    expect(fieldPositionCellLabel(5, config)).toBe("B2");
    expect(fieldPositionCellLabel(11, config)).toBe("D3");
    expect(fieldPositionCellLabel(99, config)).toBe("");
    expect(toggleFieldPositionCell(undefined, 5, config)).toEqual([5]);
    expect(toggleFieldPositionCell([5], 1, config)).toEqual([1, 5]);
    expect(toggleFieldPositionCell([1, 5], 5, config)).toEqual([1]);
    expect(toggleFieldPositionCell([1], 99, config)).toEqual([1]);
    expect(normalizeFieldPositionCells([3, 3, 40, "x"], config)).toEqual([3]);
  });

  it("clamps a nonsense grid instead of trusting it", () => {
    const config = fieldPositionConfig({ config: { gridCols: 99, gridRows: 0 } });
    expect(config.gridCols).toBe(12);
    expect(config.gridRows).toBe(2);
  });
});

describe("form reset behavior", () => {
  const schema = schemaOf(
    { key: "station", label: "Station", type: "short_answer", config: { resetBehavior: "preserve" } },
    { key: "match_no", label: "Match", type: "number", config: { resetBehavior: "increment" } },
    { key: "run", label: "Run", type: "short_answer", config: { resetBehavior: "increment" } },
    counterField,
    sectionField,
  );

  it("defaults to reset and reads explicit behaviors", () => {
    expect(fieldResetBehavior({ config: undefined })).toBe("reset");
    expect(fieldResetBehavior({ config: { resetBehavior: "nonsense" } })).toBe("reset");
    expect(fieldResetBehavior({ config: { resetBehavior: "preserve" } })).toBe("preserve");
  });

  it("keeps preserved answers, steps incrementing ones, and drops the rest", () => {
    expect(
      applyFormResetBehavior(schema, {
        station: "red 2",
        match_no: 12,
        run: "qm09",
        cycles: 7,
        auto_section: undefined,
      }),
    ).toEqual({ station: "red 2", match_no: 13, run: "qm10" });
  });

  it("increments trailing digits and gives up on unnumbered text", () => {
    expect(incrementValue(4)).toBe(5);
    expect(incrementValue("qm12")).toBe("qm13");
    expect(incrementValue("q09")).toBe("q10");
    expect(incrementValue("red")).toBeUndefined();
  });
});

describe("studio types in disagreement detection", () => {
  it("uses the numeric threshold for counters and skips spatial/stopwatch fields", () => {
    const schema = schemaOf(
      { ...counterField, disagreementThreshold: 1 },
      lapTimerField,
      positionField,
      multiSelectField,
    );
    const disagreements = detectDisagreements(schema, [
      {
        id: "a",
        confidence: "normal",
        payload: {
          cycles: 4,
          cycle_time: [4],
          scoring_spots: [1],
          capabilities: ["climb", "defense"],
        },
      },
      {
        id: "b",
        confidence: "normal",
        payload: {
          cycles: 4,
          cycle_time: [9],
          scoring_spots: [7],
          capabilities: ["defense", "climb"],
        },
      },
    ]);
    // Same counter within threshold, laps/positions skipped, multi-select order ignored.
    expect(disagreements).toEqual([]);

    const wide = detectDisagreements(schema, [
      { id: "a", confidence: "normal", payload: { cycles: 2 } },
      { id: "b", confidence: "normal", payload: { cycles: 9 } },
    ]);
    expect(wide.map((item) => item.fieldKey)).toEqual(["cycles"]);
  });
});
