import { describe, expect, it } from "vitest";
import { box, part } from "./fixtures";
import {
  buildCutList,
  cutLine,
  fabricationFor,
  holeLines,
  materialLine,
  threadDesignation,
  unspecifiedCutNotes,
} from "./fabrication";
import { NOT_IN_CAD, type FeatureFacts } from "./model";
import { drillDesignation, quantityToMm, tapDrillFor } from "./units";

function feature(input: Partial<FeatureFacts> & { id: string; featureType: string }): FeatureFacts {
  return {
    elementId: "el",
    name: input.id,
    suppressed: false,
    parameters: {},
    ...input,
  };
}

describe("units", () => {
  it("reads the Onshape expressions it can evaluate exactly", () => {
    expect(quantityToMm("0.196 in")).toBeCloseTo(4.9784, 4);
    expect(quantityToMm("12.7 mm")).toBe(12.7);
    expect(quantityToMm("0.0127 m")).toBeCloseTo(12.7, 6);
    expect(quantityToMm(0.0127)).toBeCloseTo(12.7, 6);
  });

  it("refuses an expression it cannot evaluate rather than approximating it", () => {
    expect(quantityToMm("#tubeLength")).toBeNull();
    expect(quantityToMm("2 * 0.5 in")).toBeNull();
    expect(quantityToMm("")).toBeNull();
    expect(quantityToMm(null)).toBeNull();
  });

  it("names a standard drill only when the diameter really is one", () => {
    expect(drillDesignation(4.9784)).toBe("#9");
    expect(drillDesignation(25.4 * 0.25)).toBe("1/4");
    expect(drillDesignation(25.4 * 0.199)).toBe("#8");
    // 0.200" sits a full thousandth from both #8 (0.199) and #7 (0.201), so
    // neither name is stated. A student who reads "#8" must get a #8 hole.
    expect(drillDesignation(25.4 * 0.2)).toBeNull();
    expect(drillDesignation(25.4 * 0.17)).toBeNull();
    expect(drillDesignation(0)).toBeNull();
  });

  it("only knows the tap drills that are in the table", () => {
    expect(tapDrillFor("10-32")).toBe("#21");
    expect(tapDrillFor("#10-32")).toBe("#21");
    expect(tapDrillFor("M5x0.8")).toBeNull();
  });
});

describe("hole features", () => {
  it("turns a dimensioned hole into a drill line with its designation and count", () => {
    const lines = holeLines(
      [
        feature({
          id: "F1",
          name: "Bolt circle",
          featureType: "hole",
          parameters: {
            holeDiameter: "0.196 in",
            endStyle: "THROUGH",
            holeLocations__count: 4,
          },
        }),
      ],
      1,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.confirmed).toBe(true);
    expect(lines[0]!.text).toContain("dia 0.196 in".replace("dia ", "Ø"));
    expect(lines[0]!.text).toContain("(#9)");
    expect(lines[0]!.text).toContain("through");
    expect(lines[0]!.text).toContain("4 places");
    expect(lines[0]!.featureId).toBe("F1");
  });

  it("says the count is not readable rather than assuming one hole", () => {
    const lines = holeLines(
      [feature({ id: "F2", featureType: "hole", parameters: { holeDiameter: "0.196 in" } })],
      1,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]!.confirmed).toBe(false);
    expect(lines[1]!.text).toContain(NOT_IN_CAD);
  });

  it("refuses to state a diameter the feature does not carry", () => {
    const lines = holeLines([feature({ id: "F3", featureType: "hole", parameters: { style: "SIMPLE" } })], 1);
    expect(lines[0]!.confirmed).toBe(false);
    expect(lines[0]!.text).toContain(NOT_IN_CAD);
  });

  it("states a thread only when the CAD names one", () => {
    const named = holeLines(
      [
        feature({
          id: "F4",
          featureType: "hole",
          parameters: { holeDiameter: "0.159 in", tappedOrClearance: "TAPPED", standardTapSize: "#10-32" },
        }),
      ],
      1,
    );
    expect(named[0]!.kind).toBe("tap");
    expect(named[0]!.confirmed).toBe(true);
    expect(named[0]!.text).toContain("Tap 10-32");
    expect(named[0]!.text).toContain("tap drill #21");

    const unnamed = holeLines(
      [
        feature({
          id: "F5",
          featureType: "hole",
          parameters: { holeDiameter: "0.159 in", tappedOrClearance: "TAPPED" },
        }),
      ],
      1,
    );
    expect(unnamed[0]!.confirmed).toBe(false);
    expect(unnamed[0]!.text).toContain(NOT_IN_CAD);
  });

  it("warns when a Part Studio holds several parts, because the feature does not say which", () => {
    const lines = holeLines(
      [
        feature({
          id: "F6",
          featureType: "hole",
          parameters: { holeDiameter: "0.196 in", endStyle: "THROUGH", holeLocations__count: 2 },
        }),
      ],
      3,
    );
    expect(lines[0]!.text).toContain("holds 3 parts");
  });

  it("ignores suppressed features — a suppressed hole is not drilled", () => {
    expect(
      holeLines([feature({ id: "F7", featureType: "hole", suppressed: true, parameters: { holeDiameter: "0.196 in" } })], 1),
    ).toHaveLength(0);
  });

  it("reads a thread designation only out of a thread-shaped parameter", () => {
    expect(threadDesignation(feature({ id: "a", featureType: "hole", parameters: { standardTapSize: "#10-32" } }))).toBe("10-32");
    expect(threadDesignation(feature({ id: "b", featureType: "hole", parameters: { name: "Hole 4-5" } }))).toBeNull();
  });
});

describe("cut and material lines", () => {
  const tube = part({
    key: "t",
    name: "1x1 box tube",
    bboxMm: box(0, 444.5, 0, 25.4, 0, 25.4),
    material: "6061 aluminium",
  });

  it("calls it a cut when a feature actually sets the length", () => {
    const line = cutLine(tube, [
      feature({ id: "E1", featureType: "extrude", parameters: { depth: "17.5 in", operationType: "NEW" } }),
    ]);
    expect(line.confirmed).toBe(true);
    expect(line.text).toContain("17.50 in");
    expect(line.featureId).toBe("E1");
  });

  it("refuses to call the modelled length a cut when no feature sets it", () => {
    const line = cutLine(tube, []);
    expect(line.confirmed).toBe(false);
    expect(line.text).toContain("17.50 in");
    expect(line.text).toContain("no feature sets that length");
    expect(line.text).toContain(NOT_IN_CAD);
  });

  it("states no length at all with no bounding box", () => {
    const line = cutLine(part({ key: "x", name: "Bracket" }), []);
    expect(line.confirmed).toBe(false);
    expect(line.text).toContain(NOT_IN_CAD);
    expect(line.text).not.toMatch(/\d+\.\d+ in/);
  });

  it("says when no material is assigned", () => {
    expect(materialLine(tube).confirmed).toBe(true);
    const none = materialLine(part({ key: "x", name: "Bracket" }));
    expect(none.confirmed).toBe(false);
    expect(none.text).toContain(NOT_IN_CAD);
  });

  it("flags an unmeasurable removal instead of skipping it", () => {
    const notes = unspecifiedCutNotes([
      feature({ id: "E2", name: "Lightening pocket", featureType: "extrude", parameters: { operationType: "REMOVE" } }),
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.confirmed).toBe(false);
    expect(notes[0]!.text).toContain("removes material");
  });
});

describe("fabricationFor", () => {
  it("gives hardware no shop instructions — you fetch a bolt, you do not make one", () => {
    expect(
      fabricationFor({
        part: part({ key: "s", name: "10-32 SHCS", bboxMm: box(0, 25, 0, 5, 0, 5) }),
        features: [],
        partsInStudio: 1,
        isFastener: true,
      }),
    ).toEqual([]);
  });

  it("says nothing about making a part Onshape did not resolve", () => {
    const lines = fabricationFor({ part: null, features: [], partsInStudio: 1, isFastener: false });
    expect(lines[0]!.confirmed).toBe(false);
    expect(lines[0]!.text).toContain(NOT_IN_CAD);
  });

  it("orders the lines the way a shop works: material, cut, then holes", () => {
    const lines = fabricationFor({
      part: part({ key: "t", name: "Tube", bboxMm: box(0, 100, 0, 25, 0, 25), material: "6061" }),
      features: [feature({ id: "F", featureType: "hole", parameters: { holeDiameter: "0.196 in", holeLocations__count: 2 } })],
      partsInStudio: 1,
      isFastener: false,
    });
    expect(lines.map((line) => line.kind).slice(0, 3)).toEqual(["material", "cut", "drill"]);
  });
});

describe("buildCutList", () => {
  it("counts instances, marks unconfirmed lengths, and leaves hardware out", () => {
    const parts = [
      part({ key: "tube", name: "1x1 tube", bboxMm: box(0, 444.5, 0, 25.4, 0, 25.4), material: "6061" }),
      part({ key: "bolt", name: "10-32 SHCS", bboxMm: box(0, 25, 0, 5, 0, 5) }),
    ];
    const rows = buildCutList(
      parts,
      new Map([
        ["tube", 4],
        ["bolt", 16],
      ]),
      new Map(),
      new Set(["bolt"]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partName).toBe("1x1 tube");
    expect(rows[0]!.quantity).toBe(4);
    expect(rows[0]!.lengthConfirmed).toBe(false);
  });

  it("drops a part no instance uses rather than listing stock nobody needs", () => {
    const rows = buildCutList([part({ key: "a", name: "Unused" })], new Map(), new Map(), new Set());
    expect(rows).toEqual([]);
  });
});
