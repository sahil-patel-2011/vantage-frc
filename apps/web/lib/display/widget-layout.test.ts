import { describe, expect, it } from "vitest";
import { DISPLAY_WIDGET_TYPES, PRESET_WIDGETS, type DisplayWidgetType } from "../display";
import {
  MAX_WIDGETS,
  MIN_WIDGETS,
  WIDGET_LABEL,
  addWidget,
  availableWidgets,
  fromGridLayout,
  layoutProblem,
  matchesPreset,
  normalizeWidgets,
  nudgeWidget,
  removeWidget,
  reorderWidgets,
  toGridLayout,
} from "./widget-layout";

const THREE: DisplayWidgetType[] = ["next_match", "alerts", "prediction"];

describe("WIDGET_LABEL", () => {
  it("names every widget a board can hold", () => {
    // A widget with no label renders as a raw identifier on a television.
    for (const type of DISPLAY_WIDGET_TYPES) {
      expect(WIDGET_LABEL[type], type).toBeTruthy();
    }
  });
});

describe("normalizeWidgets", () => {
  it("drops anything that is not a real widget", () => {
    expect(normalizeWidgets(["next_match", "nonsense", 7, null])).toEqual(["next_match"]);
  });

  it("keeps the first of a repeat rather than showing a panel twice", () => {
    expect(normalizeWidgets(["alerts", "next_match", "alerts"])).toEqual(["alerts", "next_match"]);
  });

  it("refuses to load more panels than fit", () => {
    expect(normalizeWidgets([...DISPLAY_WIDGET_TYPES]).length).toBe(MAX_WIDGETS);
  });

  it("preserves order", () => {
    expect(normalizeWidgets(["prediction", "alerts"])).toEqual(["prediction", "alerts"]);
  });
});

describe("reorderWidgets", () => {
  it("moves a panel to the front", () => {
    expect(reorderWidgets(THREE, 2, 0)).toEqual(["prediction", "next_match", "alerts"]);
  });

  it("moves a panel to the back", () => {
    expect(reorderWidgets(THREE, 0, 2)).toEqual(["alerts", "prediction", "next_match"]);
  });

  it("leaves the list alone when a drag ends outside it", () => {
    // A drag that finished off the list is a cancelled drag. Clamping would
    // move the panel somewhere nobody asked for.
    expect(reorderWidgets(THREE, 0, 9)).toEqual(THREE);
    expect(reorderWidgets(THREE, -1, 0)).toEqual(THREE);
    expect(reorderWidgets(THREE, 0, -1)).toEqual(THREE);
  });

  it("leaves the list alone when nothing moved", () => {
    expect(reorderWidgets(THREE, 1, 1)).toEqual(THREE);
  });

  it("refuses a fractional index rather than rounding it", () => {
    expect(reorderWidgets(THREE, 0.5, 2)).toEqual(THREE);
  });

  it("never loses or duplicates a panel", () => {
    for (let from = 0; from < THREE.length; from += 1) {
      for (let to = 0; to < THREE.length; to += 1) {
        const result = reorderWidgets(THREE, from, to);
        expect([...result].sort(), `${from}->${to}`).toEqual([...THREE].sort());
      }
    }
  });

  it("returns a new list rather than mutating the one it was given", () => {
    const original = [...THREE];
    reorderWidgets(original, 0, 2);
    expect(original).toEqual(THREE);
  });
});

describe("nudgeWidget", () => {
  it("moves a panel one place either way", () => {
    expect(nudgeWidget(THREE, "alerts", "up")).toEqual(["alerts", "next_match", "prediction"]);
    expect(nudgeWidget(THREE, "alerts", "down")).toEqual(["next_match", "prediction", "alerts"]);
  });

  it("does nothing at the ends", () => {
    // The button stays disabled, but the model must not rely on that.
    expect(nudgeWidget(THREE, "next_match", "up")).toEqual(THREE);
    expect(nudgeWidget(THREE, "prediction", "down")).toEqual(THREE);
  });

  it("does nothing for a panel that is not on the board", () => {
    expect(nudgeWidget(THREE, "team_intel", "up")).toEqual(THREE);
  });
});

describe("addWidget and removeWidget", () => {
  it("appends a new panel", () => {
    expect(addWidget(THREE, "team_intel")).toEqual([...THREE, "team_intel"]);
  });

  it("will not add the same panel twice", () => {
    expect(addWidget(THREE, "alerts")).toEqual(THREE);
  });

  it("will not overfill the board", () => {
    const full = normalizeWidgets([...DISPLAY_WIDGET_TYPES]);
    const extra = DISPLAY_WIDGET_TYPES.find((type) => !full.includes(type))!;
    expect(addWidget(full, extra)).toEqual(full);
  });

  it("removes a panel", () => {
    expect(removeWidget(THREE, "alerts")).toEqual(["next_match", "prediction"]);
  });

  it("refuses to empty the board", () => {
    // A board with nothing on it is a blank television in a pit.
    const one: DisplayWidgetType[] = ["next_match"];
    expect(removeWidget(one, "next_match")).toEqual(one);
    expect(one.length).toBe(MIN_WIDGETS);
  });

  it("ignores a removal of something that is not there", () => {
    expect(removeWidget(THREE, "team_intel")).toEqual(THREE);
  });
});

describe("availableWidgets", () => {
  it("offers only what is not already on the board", () => {
    const available = availableWidgets(THREE);
    for (const type of THREE) expect(available).not.toContain(type);
    expect(available.length).toBe(DISPLAY_WIDGET_TYPES.length - THREE.length);
  });

  it("offers nothing when everything is on", () => {
    expect(availableWidgets([...DISPLAY_WIDGET_TYPES])).toEqual([]);
  });
});

describe("toGridLayout and fromGridLayout", () => {
  it("lays panels out two across in reading order", () => {
    const layout = toGridLayout(THREE);
    expect(layout[0]).toMatchObject({ type: "next_match", x: 0, y: 0 });
    expect(layout[1]).toMatchObject({ type: "alerts", x: 6, y: 0 });
    expect(layout[2]).toMatchObject({ type: "prediction", x: 0, y: 4 });
  });

  it("gives every panel a size", () => {
    for (const cell of toGridLayout(THREE)) {
      expect(cell.w).toBeGreaterThan(0);
      expect(cell.h).toBeGreaterThan(0);
    }
  });

  it("round-trips a saved board back to the same order", () => {
    expect(fromGridLayout(toGridLayout(THREE))).toEqual(THREE);
  });

  it("survives a saved board containing a widget that no longer exists", () => {
    // Boards outlive widget catalogues. A removed panel type must not take the
    // whole board down with it.
    const saved = [...toGridLayout(THREE), { type: "retired_widget", x: 0, y: 8, w: 6, h: 4 }];
    expect(fromGridLayout(saved)).toEqual(THREE);
  });
});

describe("matchesPreset", () => {
  it("recognises an untouched preset", () => {
    for (const [preset, widgets] of Object.entries(PRESET_WIDGETS)) {
      expect(matchesPreset(widgets, preset), preset).toBe(true);
    }
  });

  it("notices a reorder, not just an add or remove", () => {
    // Order is the whole point on a pit screen, so a reordered preset is a
    // customised board and must say so.
    const base = PRESET_WIDGETS.event_command!;
    expect(matchesPreset(reorderWidgets(base, 0, 2), "event_command")).toBe(false);
  });

  it("notices an added panel", () => {
    expect(matchesPreset(addWidget(PRESET_WIDGETS.next_match!, "prediction"), "next_match")).toBe(
      false,
    );
  });

  it("is false for a preset that does not exist", () => {
    expect(matchesPreset(THREE, "custom")).toBe(false);
    expect(matchesPreset(THREE, "nope")).toBe(false);
  });
});

describe("layoutProblem", () => {
  it("is silent about a board that is fine", () => {
    expect(layoutProblem(THREE)).toBeNull();
  });

  it("refuses an empty board", () => {
    expect(layoutProblem([])).toMatch(/at least one/i);
  });

  it("refuses an overfull board and says why", () => {
    const tooMany = [...DISPLAY_WIDGET_TYPES];
    expect(tooMany.length).toBeGreaterThan(MAX_WIDGETS);
    expect(layoutProblem(tooMany)).toMatch(/read across a pit/i);
  });
});
