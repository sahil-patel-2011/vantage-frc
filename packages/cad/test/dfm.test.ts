/**
 * DFM assembly tests.
 *
 * These assert real numbers, not shapes. The anchor is the one measured ground
 * truth the compensation model was fitted to: an M3 normal-clearance hole is
 * nominally 3.40 mm (ISO 273) and has to be MODELLED at 3.62 mm to print
 * correctly on a Bambu X1C in PLA with a 0.4 mm nozzle. If that number moves,
 * every printed hole on every FRC part moves with it.
 */

import { describe, expect, it } from "vitest";

import {
  BAMBU_LAB_P1S,
  BAMBU_LAB_X1C,
  PLA,
  SNAPMAKER_U1,
  applyDfmCompensation,
  checkPart,
  clearanceHoleMm,
  compensateHoleDiameter,
  describeDfmReport,
  describeModelledPart,
  extrusionWidthMm,
  footprintFitsAtDeg,
  minimumWallMm,
  optimumBossWallMm,
  recommendedWallMm,
  requireInsert,
  requiredBoreDepthMm,
  requiredBossWallMm,
  smallestFittingRotationDeg,
  usableHeightMm,
  type CheckFinding,
  type CheckId,
  type DfmReport,
  type ModelledPart,
} from "../src/dfm";
import { ROTATION_SEARCH_STEP_DEG } from "../src/dfm/checks";
import { generatePartFeatureScript } from "../src/featurescript/generate";

function findingsFor(report: DfmReport, check: CheckId): CheckFinding[] {
  return report.findings.filter((finding) => finding.check === check);
}

function findingFor(report: DfmReport, check: CheckId): CheckFinding {
  const finding = findingsFor(report, check)[0];
  if (!finding) throw new Error(`No "${check}" finding. Got: ${report.findings.map((f) => f.check).join(", ")}`);
  return finding;
}

/** 60 x 40 x 6 plate with four M3 clearance holes 10 mm in from each edge. */
function m3Plate(): ModelledPart {
  return {
    name: "M3 clearance plate",
    base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 },
    holes: [
      {
        id: "m3Clear",
        diameterMm: clearanceHoleMm("M3"),
        pattern: { kind: "corners", insetXMm: 10, insetYMm: 10 },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The anchor
// ---------------------------------------------------------------------------

describe("hole compensation anchor", () => {
  it("turns a 3.40 mm M3 clearance hole into 3.62 mm to model on an X1C in PLA", () => {
    expect(clearanceHoleMm("M3")).toBe(3.4);

    const compensation = compensateHoleDiameter(3.4, BAMBU_LAB_X1C, PLA);
    expect(compensation.nominalDiameterMm).toBe(3.4);
    expect(compensation.compensatedDiameterMm).toBe(3.62);
    expect(compensation.totalOffsetMm).toBe(0.22);
    // The slicer's XY hole compensation field is a radius, so half the diameter.
    expect(compensation.slicerRadialEquivalentMm).toBe(0.11);
    expect(compensation.calibrated).toBe(true);
  });

  it("reaches 3.62 mm through checkPart on a real plate, not just the helper", () => {
    const report = checkPart({ part: m3Plate(), printerId: "bambu-x1c", materialId: "pla" });

    const hole = report.compensatedHoles.find((entry) => entry.featureId === "hole:m3Clear");
    expect(hole?.nominalDiameterMm).toBe(3.4);
    expect(hole?.compensatedDiameterMm).toBe(3.62);

    const dimension = report.modelledDimensions.find((entry) => entry.path === "holes.0.diameterMm");
    expect(dimension?.nominalMm).toBe(3.4);
    expect(dimension?.modelMm).toBe(3.62);
  });

  it("writes 3.62 mm into a copy and leaves the caller's 3.40 mm alone", () => {
    const part = m3Plate();
    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const compensated = applyDfmCompensation(part, report);

    expect(compensated.holes?.[0]?.diameterMm).toBe(3.62);
    expect(part.holes?.[0]?.diameterMm).toBe(3.4);
  });

  it("hands the generator a part that builds the 3.62 mm hole, not the 3.40 mm one", () => {
    const part = m3Plate();
    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const generated = generatePartFeatureScript(applyDfmCompensation(part, report));
    const diameter = generated.parameters.find((entry) => entry.path === "holes.0.diameterMm");

    expect(diameter?.value).toBe(3.62);
    expect(diameter?.expression).toBe("3.62 mm");
    expect(generated.geometry.holes.every((hole) => hole.diameterMm === 3.62)).toBe(true);
  });
});

describe("hole compensation is a model, not a table rigged for M3", () => {
  const iso273Normal: ReadonlyArray<[string, number, number]> = [
    // thread, ISO 273 normal clearance, diameter to model on an X1C in PLA
    ["M2", 2.4, 2.63],
    ["M2.5", 2.9, 3.12],
    ["M3", 3.4, 3.62],
    ["M4", 4.5, 4.72],
    ["M5", 5.5, 5.72],
    ["M6", 6.6, 6.82],
    ["M8", 9.0, 9.22],
  ];

  it.each(iso273Normal)("compensates %s (%d mm nominal) to %d mm", (_thread, nominal, expected) => {
    expect(compensateHoleDiameter(nominal, BAMBU_LAB_X1C, PLA).compensatedDiameterMm).toBe(expected);
  });

  it("moves each term the way the physics says it should across M2-M8", () => {
    const terms = iso273Normal.map(([, nominal]) => compensateHoleDiameter(nominal, BAMBU_LAB_X1C, PLA).terms);

    // Squish is a property of the bead, so it is the same for every diameter.
    const squish = terms.map((term) => term.squishMm);
    expect(new Set(squish).size).toBe(1);
    expect(squish[0]).toBeCloseTo(extrusionWidthMm(0.4) * PLA.holeSquishFractionOfExtrusionWidth, 3);

    // Walking a circle as straight segments costs proportionally less on a big
    // hole, so this term falls strictly as the diameter grows.
    for (let i = 1; i < terms.length; i += 1) {
      expect(terms[i]!.curveApproximationMm).toBeLessThan(terms[i - 1]!.curveApproximationMm);
    }

    // Shrinkage is a fraction of the diameter, so it rises strictly.
    for (let i = 1; i < terms.length; i += 1) {
      expect(terms[i]!.shrinkageMm).toBeGreaterThan(terms[i - 1]!.shrinkageMm);
    }

    // The two moving terms pull opposite ways, so the total offset is not
    // monotonic — it dips in the middle of the range. A lookup table fitted to
    // M3 could not produce that.
    const totals = iso273Normal.map(([, nominal]) => compensateHoleDiameter(nominal, BAMBU_LAB_X1C, PLA).totalOffsetMm);
    expect(Math.min(...totals)).toBeLessThan(totals[0]!);
    expect(Math.min(...totals)).toBeLessThan(totals[totals.length - 1]!);
  });

  it("scales the squish term with the nozzle, so a 0.6 mm bead needs more compensation", () => {
    const wide = { ...BAMBU_LAB_X1C, nozzleDiameterMm: 0.6 };
    const narrow = compensateHoleDiameter(3.4, BAMBU_LAB_X1C, PLA);
    const broad = compensateHoleDiameter(3.4, wide, PLA);

    expect(broad.terms.squishMm).toBeCloseTo(extrusionWidthMm(0.6) * PLA.holeSquishFractionOfExtrusionWidth, 3);
    expect(broad.compensatedDiameterMm).toBeGreaterThan(narrow.compensatedDiameterMm);
    // The fit was measured on a 0.4 mm nozzle, so a 0.6 is no longer calibrated.
    expect(broad.calibrated).toBe(false);
  });

  it("compensates a heat-set bore so the printed hole lands on the supplier's 4.0 mm", () => {
    const part: ModelledPart = {
      name: "boss plate",
      base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 },
      bosses: [
        {
          id: "insertBoss",
          centerXMm: 0,
          centerYMm: 0,
          outerDiameterMm: 13.8,
          heightMm: 8,
          insertDiameterMm: 4.0,
          insertDepthMm: 7,
        },
      ],
    };
    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const bore = report.compensatedInsertBores[0];

    expect(bore?.insert).toBe("M3x5.7");
    expect(bore?.nominalBoreMm).toBe(4.0);
    expect(bore?.compensatedBoreMm).toBe(4.22);
    expect(bore?.requiredDepthMm).toBe(6.7);
  });
});

// ---------------------------------------------------------------------------
// Bed fit
// ---------------------------------------------------------------------------

describe("bed fit", () => {
  it("passes a part that fits the X1C square to the axes", () => {
    const report = checkPart({ part: m3Plate(), printerId: "bambu-x1c", materialId: "pla" });

    expect(report.bedFit.envelopeMm).toEqual({ x: 256, y: 256, z: 256 });
    expect(report.bedFit.fitsAsModelled).toBe(true);
    expect(report.bedFit.fittingRotationDeg).toBe(0);
    expect(findingFor(report, "bed-fit").severity).toBe("pass");
  });

  it("warns, not fails, when a long plate only fits after being turned on the plate", () => {
    // 300 mm across a 256 mm bed: too long square to X, too long square to Y,
    // but it fits on the diagonal.
    const part: ModelledPart = {
      name: "arm plate",
      base: { kind: "plate", widthMm: 300, depthMm: 40, thicknessMm: 6 },
    };
    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const fit = report.bedFit;

    expect(fit.fitsAsModelled).toBe(false);
    expect(fit.fitsRotated90).toBe(false);
    expect(fit.fits).toBe(true);

    // 300*cos(t) + 40*sin(t) = 256 solves at t ~= 39.83 deg.
    expect(fit.fittingRotationDeg).toBeGreaterThan(39.5);
    expect(fit.fittingRotationDeg).toBeLessThan(40.5);

    // It really is the SMALLEST such rotation: one search step earlier does not fit.
    const angle = fit.fittingRotationDeg!;
    expect(footprintFitsAtDeg(angle, 300, 40, 256, 256)).toBe(true);
    expect(footprintFitsAtDeg(angle - ROTATION_SEARCH_STEP_DEG, 300, 40, 256, 256)).toBe(false);

    const finding = findingFor(report, "bed-fit");
    expect(finding.severity).toBe("warn");
    expect(finding.fix).toContain("Rotate the part");
  });

  it("fails a footprint no rotation can rescue", () => {
    // A 256 mm square bed has a 362 mm diagonal, so being over in one axis is
    // not enough to rule a part out — 100 x 260 still fits on the diagonal.
    expect(smallestFittingRotationDeg(100, 260, 256, 256)).not.toBeNull();
    // 400 mm is past what the diagonal can absorb at this width.
    expect(smallestFittingRotationDeg(100, 400, 256, 256)).toBeNull();

    const part: ModelledPart = {
      name: "oversize plate",
      base: { kind: "plate", widthMm: 400, depthMm: 100, thicknessMm: 6 },
    };
    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingFor(report, "bed-fit");

    expect(report.bedFit.fits).toBe(false);
    expect(report.bedFit.fittingRotationDeg).toBeNull();
    expect(finding.severity).toBe("fail");
    expect(finding.message).toContain("at any Z-rotation");
  });

  it("tells the user to make the quarter turn on a rectangular bed", () => {
    // The H2D is 325 x 320 for a single-nozzle part, so 322 deep is 2 mm over in
    // Y and comfortably inside in X.
    const part: ModelledPart = {
      name: "H2D plate",
      base: { kind: "plate", widthMm: 300, depthMm: 322, thicknessMm: 6 },
    };
    const report = checkPart({ part, printerId: "bambu-h2d", materialId: "pla" });
    const finding = findingFor(report, "bed-fit");

    expect(report.bedFit.envelopeMm).toEqual({ x: 325, y: 320, z: 325 });
    expect(report.bedFit.fitsAsModelled).toBe(false);
    expect(report.bedFit.fitsRotated90).toBe(true);
    expect(finding.severity).toBe("warn");
    // A hair under 90 also fits, but nobody places a part at 89.45 degrees.
    expect(report.bedFit.fittingRotationDeg).toBeLessThan(90);
    expect(finding.fix).toContain("Rotate the part 90 degrees");
  });

  it("finds an exact quarter-turn fit when that is the only orientation there is", () => {
    // A 100 x 250 part on a 250 x 100 bed is flush at 90 degrees and over in X
    // at every angle below it.
    expect(smallestFittingRotationDeg(100, 250, 250, 100)).toBe(90);
    expect(footprintFitsAtDeg(90 - ROTATION_SEARCH_STEP_DEG, 100, 250, 250, 100)).toBe(false);
  });

  it("fails a part taller than the height the vendor slicer actually allows", () => {
    // The P1S build volume is 256 mm tall but Bambu Studio caps the printable
    // height at 250 mm by default, so 255 mm is not buildable.
    expect(BAMBU_LAB_P1S.buildVolumeMm.z).toBe(256);
    expect(usableHeightMm(BAMBU_LAB_P1S)).toBe(250);

    const part: ModelledPart = {
      name: "tall box",
      base: { kind: "box", widthMm: 100, depthMm: 100, heightMm: 255, wallMm: 2 },
    };
    const report = checkPart({ part, printerId: "bambu-p1s", materialId: "pla" });
    const finding = findingFor(report, "bed-fit");

    expect(report.bedFit.fits).toBe(false);
    expect(finding.severity).toBe("fail");
    expect(finding.measured).toBe(255);
    expect(finding.required).toBe(250);
    expect(finding.message).toContain("250 mm by the vendor slicer default");
  });
});

// ---------------------------------------------------------------------------
// Minimum wall
// ---------------------------------------------------------------------------

describe("minimum wall vs the bead the nozzle lays", () => {
  const boxWithWall = (wallMm: number): ModelledPart => ({
    name: "wall box",
    base: { kind: "box", widthMm: 60, depthMm: 40, heightMm: 20, wallMm },
  });

  it("derives the thresholds from the extrusion width, not from a fixed millimetre", () => {
    expect(extrusionWidthMm(0.4)).toBeCloseTo(0.42, 10);
    expect(minimumWallMm(BAMBU_LAB_X1C)).toBeCloseTo(0.42, 10);
    expect(recommendedWallMm(BAMBU_LAB_X1C)).toBeCloseTo(0.84, 10);
    // A 0.6 mm nozzle moves both thresholds with it.
    expect(recommendedWallMm({ ...BAMBU_LAB_X1C, nozzleDiameterMm: 0.6 })).toBeCloseTo(1.26, 10);
  });

  it("fails a wall thinner than one 0.42 mm bead", () => {
    const report = checkPart({ part: boxWithWall(0.3), printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingsFor(report, "min-wall").find((entry) => entry.feature === "base.wall");

    expect(finding?.severity).toBe("fail");
    expect(finding?.measured).toBe(0.3);
    expect(finding?.required).toBe(0.42);
    expect(finding?.fix).toContain("0.84 mm");
    expect(report.status).toBe("fail");
  });

  it("warns at one bead but under two perimeters", () => {
    const report = checkPart({ part: boxWithWall(0.6), printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingsFor(report, "min-wall").find((entry) => entry.feature === "base.wall");

    expect(finding?.severity).toBe("warn");
    expect(finding?.measured).toBe(0.6);
    expect(finding?.required).toBe(0.84);
  });

  it("passes at two perimeters and names the thinnest wall it looked at", () => {
    const report = checkPart({ part: boxWithWall(2), printerId: "bambu-x1c", materialId: "pla" });
    const findings = findingsFor(report, "min-wall");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("pass");
    expect(findings[0]?.measured).toBe(2);
  });

  it("picks up a rib and a pocket floor as walls of their own", () => {
    const part: ModelledPart = {
      name: "ribbed plate",
      base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 },
      pockets: [{ id: "lightening", centerXMm: 0, centerYMm: 0, widthMm: 20, depthMm: 20, cutDepthMm: 5.7 }],
      ribs: [{ id: "spine", fromXMm: -20, fromYMm: 0, toXMm: 20, toYMm: 0, thicknessMm: 0.35, heightMm: 5 }],
    };
    const derived = describeModelledPart(part);
    const walls = Object.fromEntries((derived.description.walls ?? []).map((wall) => [wall.id, wall.thicknessMm]));

    expect(walls["base.thickness"]).toBe(6);
    // 6 mm plate, 5.7 mm pocket: 0.3 mm of floor left under it.
    expect(walls["pocket:lightening.floor"]).toBeCloseTo(0.3, 10);
    expect(walls["rib:spine"]).toBe(0.35);

    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const failed = findingsFor(report, "min-wall")
      .filter((finding) => finding.severity === "fail")
      .map((finding) => finding.feature);
    expect(failed).toEqual(["pocket:lightening.floor", "rib:spine"]);
  });
});

// ---------------------------------------------------------------------------
// Hole to edge
// ---------------------------------------------------------------------------

describe("hole to edge", () => {
  const plateWithHoleAt = (xMm: number): ModelledPart => ({
    name: "edge plate",
    base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 },
    holes: [
      {
        id: "m3Clear",
        diameterMm: 3.4,
        pattern: { kind: "explicit", points: [{ xMm, yMm: 0 }] },
      },
    ],
  });

  it("fails when less than one bead of material is left to the edge", () => {
    // Centre 2 mm from the edge, modelled hole 3.62 mm across: 0.19 mm of wall.
    const report = checkPart({ part: plateWithHoleAt(28), printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingFor(report, "hole-to-edge");

    expect(finding.severity).toBe("fail");
    expect(finding.measured).toBe(2);
    // radius 1.81 + one 0.42 mm bead.
    expect(finding.required).toBe(2.23);
  });

  it("warns between printable and the 1.5x-diameter strength guideline", () => {
    const report = checkPart({ part: plateWithHoleAt(25), printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingFor(report, "hole-to-edge");

    expect(finding.severity).toBe("warn");
    expect(finding.measured).toBe(5);
    // 1.5 x the modelled 3.62 mm hole.
    expect(finding.required).toBe(5.43);
    // The provenance of the 1.5x figure is stated in the finding itself.
    expect(finding.message).toContain("injection moulding");
  });

  it("passes with the guideline clearance and reports the tightest hole", () => {
    const report = checkPart({ part: plateWithHoleAt(20), printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingFor(report, "hole-to-edge");

    expect(finding.severity).toBe("pass");
    expect(finding.measured).toBe(10);
    expect(finding.required).toBe(5.43);
  });

  it("measures every instance of a pattern and reports the worst", () => {
    const part: ModelledPart = {
      name: "corner plate",
      base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 },
      holes: [
        { id: "m3Clear", diameterMm: 3.4, pattern: { kind: "corners", insetXMm: 12, insetYMm: 2.1 } },
      ],
    };
    const derived = describeModelledPart(part);

    expect(derived.geometry.holes).toHaveLength(4);
    // The Y inset is the tight one, so that is the distance the rule sees.
    expect(derived.description.holes?.[0]?.centerToEdgeMm).toBeCloseTo(2.1, 10);
    expect(findingFor(checkPart({ part, printerId: "bambu-x1c", materialId: "pla" }), "hole-to-edge").severity).toBe(
      "fail",
    );
  });
});

// ---------------------------------------------------------------------------
// Heat-set inserts
// ---------------------------------------------------------------------------

describe("heat-set insert bosses", () => {
  const bossPlate = (overrides: {
    outerDiameterMm: number;
    insertDepthMm: number;
  }): ModelledPart => ({
    name: "insert plate",
    base: { kind: "plate", widthMm: 60, depthMm: 60, thicknessMm: 6 },
    bosses: [
      {
        id: "insertBoss",
        centerXMm: 0,
        centerYMm: 0,
        outerDiameterMm: overrides.outerDiameterMm,
        heightMm: 8,
        insertDiameterMm: 4.0,
        insertDepthMm: overrides.insertDepthMm,
      },
    ],
  });

  it("wants the insert body plus two thread pitches of bore", () => {
    const insert = requireInsert("M3x5.7");
    // 5.7 mm body + 2 x 0.5 mm coarse pitch.
    expect(requiredBoreDepthMm(insert)).toBe(6.7);

    const report = checkPart({
      part: bossPlate({ outerDiameterMm: 13.8, insertDepthMm: 4 }),
      printerId: "bambu-x1c",
      materialId: "pla",
    });
    const finding = findingFor(report, "insert-depth");

    expect(finding.severity).toBe("fail");
    expect(finding.measured).toBe(4);
    expect(finding.required).toBe(6.7);
    expect(finding.message).toContain("inferred from the bore diameter");
  });

  it("passes the depth once the bore is deep enough", () => {
    const report = checkPart({
      part: bossPlate({ outerDiameterMm: 13.8, insertDepthMm: 7 }),
      printerId: "bambu-x1c",
      materialId: "pla",
    });
    const finding = findingFor(report, "insert-depth");

    expect(finding.severity).toBe("pass");
    expect(finding.measured).toBe(7);
    expect(finding.required).toBe(6.7);
  });

  it("uses the insert the caller names instead of inferring one", () => {
    // M3x3 and M3x5.7 both install into a 4.0 mm bore, so a 4 mm deep bore is
    // right for one and wrong for the other.
    const report = checkPart({
      part: bossPlate({ outerDiameterMm: 13.8, insertDepthMm: 4 }),
      printerId: "bambu-x1c",
      materialId: "pla",
      inserts: { insertBoss: "M3x3" },
    });
    const finding = findingFor(report, "insert-depth");

    expect(finding.severity).toBe("pass");
    expect(finding.required).toBe(4); // 3 mm body + 2 x 0.5 mm pitch
    expect(finding.message).not.toContain("inferred");
  });

  it("holds the boss to SPIROL's 2x minimum and 3x optimum boss diameter", () => {
    const insert = requireInsert("M3x5.7");
    // 2 x 4.6 mm insert OD, less the 4.0 mm bore, halved.
    expect(requiredBossWallMm(insert)).toBe(2.6);
    expect(optimumBossWallMm(insert)).toBe(4.9);

    const thin = findingFor(
      checkPart({ part: bossPlate({ outerDiameterMm: 5, insertDepthMm: 7 }), printerId: "bambu-x1c", materialId: "pla" }),
      "insert-boss-wall",
    );
    expect(thin.severity).toBe("fail");
    expect(thin.measured).toBe(0.5);
    expect(thin.required).toBe(2.6);

    const minimum = findingFor(
      checkPart({ part: bossPlate({ outerDiameterMm: 9.2, insertDepthMm: 7 }), printerId: "bambu-x1c", materialId: "pla" }),
      "insert-boss-wall",
    );
    expect(minimum.severity).toBe("warn");
    expect(minimum.measured).toBe(2.6);
    expect(minimum.required).toBe(4.9);

    const optimum = findingFor(
      checkPart({ part: bossPlate({ outerDiameterMm: 13.8, insertDepthMm: 7 }), printerId: "bambu-x1c", materialId: "pla" }),
      "insert-boss-wall",
    );
    expect(optimum.severity).toBe("pass");
    expect(optimum.measured).toBe(4.9);
  });

  it("says so instead of guessing when no tabulated insert fits the bore", () => {
    const part: ModelledPart = {
      name: "odd bore",
      base: { kind: "plate", widthMm: 60, depthMm: 60, thicknessMm: 6 },
      bosses: [
        {
          id: "mystery",
          centerXMm: 0,
          centerYMm: 0,
          outerDiameterMm: 12,
          heightMm: 8,
          insertDiameterMm: 4.75,
          insertDepthMm: 6,
        },
      ],
    };
    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingFor(report, "insert-depth");

    expect(finding.severity).toBe("warn");
    expect(finding.required).toBeNull();
    expect(finding.fix).toContain("Name the insert");
    // No insert was resolved, so no bore compensation is claimed for it either.
    expect(report.compensatedInsertBores).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Overhangs and small features
// ---------------------------------------------------------------------------

describe("overhangs", () => {
  const withEdge = (kind: "fillet" | "chamfer"): ModelledPart => ({
    name: "edged plate",
    base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 },
    edges: [{ id: "outline", kind, selection: "all", sizeMm: 2 }],
  });

  it("fails a bottom fillet, which runs tangent to the build plate", () => {
    const report = checkPart({ part: withEdge("fillet"), printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingFor(report, "overhang");

    expect(finding.feature).toBe("edge:outline.bottom");
    expect(finding.measured).toBe(90);
    expect(finding.required).toBe(45);
    expect(finding.severity).toBe("fail");
  });

  it("passes an equal-offset chamfer, which sits exactly on the 45 degree rule", () => {
    const finding = findingFor(
      checkPart({ part: withEdge("chamfer"), printerId: "bambu-x1c", materialId: "pla" }),
      "overhang",
    );
    expect(finding.measured).toBe(45);
    expect(finding.severity).toBe("pass");
  });

  it("derives no overhang from a corners-only treatment, and says the rule did not apply", () => {
    const part: ModelledPart = {
      name: "rounded corners",
      base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 },
      edges: [{ id: "corners", kind: "fillet", selection: "corners", sizeMm: 3 }],
    };
    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });

    expect(findingsFor(report, "overhang")).toHaveLength(0);
    expect(report.notApplicable).toContain("overhang");
  });

  it("warns between 45 and 60 degrees for a face the caller supplies", () => {
    const report = checkPart({
      part: { name: "sloped", base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 } },
      printerId: "bambu-x1c",
      materialId: "pla",
      overhangs: [{ id: "gusset", angleFromVerticalDeg: 55, spanMm: 12 }],
    });
    expect(findingFor(report, "overhang").severity).toBe("warn");
  });
});

describe("features under one extrusion width", () => {
  const counterbored = (counterboreDiameterMm: number): ModelledPart => ({
    name: "counterbored plate",
    base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 8 },
    holes: [
      {
        id: "m3Cap",
        diameterMm: 3.4,
        counterbore: { diameterMm: counterboreDiameterMm, depthMm: 3.5 },
        pattern: { kind: "explicit", points: [{ xMm: 0, yMm: 0 }] },
      },
    ],
  });

  it("fails a counterbore ledge narrower than one bead", () => {
    // (3.8 - 3.4) / 2 = 0.2 mm of seat, against a 0.42 mm bead.
    const report = checkPart({ part: counterbored(3.8), printerId: "bambu-x1c", materialId: "pla" });
    const finding = findingFor(report, "small-feature");

    expect(finding.feature).toBe("hole:m3Cap.counterboreLedge");
    expect(finding.severity).toBe("fail");
    expect(finding.measured).toBe(0.2);
    expect(finding.required).toBe(0.42);
  });

  it("warns at one bead and passes at two", () => {
    // (4.4 - 3.4) / 2 = 0.5 mm: one bead, no second perimeter.
    expect(findingFor(checkPart({ part: counterbored(4.4), printerId: "bambu-x1c", materialId: "pla" }), "small-feature").severity).toBe(
      "warn",
    );
    // (6.5 - 3.4) / 2 = 1.55 mm.
    expect(findingFor(checkPart({ part: counterbored(6.5), printerId: "bambu-x1c", materialId: "pla" }), "small-feature").severity).toBe(
      "pass",
    );
  });

  it("compensates the counterbore diameter as well as the hole", () => {
    const part = counterbored(6.5);
    const report = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const paths = Object.fromEntries(report.modelledDimensions.map((entry) => [entry.path, entry.modelMm]));

    expect(paths["holes.0.diameterMm"]).toBe(3.62);
    expect(paths["holes.0.counterbore.diameterMm"]).toBe(6.72);
    expect(applyDfmCompensation(part, report).holes?.[0]?.counterbore?.diameterMm).toBe(6.72);
  });
});

// ---------------------------------------------------------------------------
// Printer / material pairing
// ---------------------------------------------------------------------------

describe("printer and material pairing", () => {
  const plate: ModelledPart = {
    name: "pairing plate",
    base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 6 },
  };
  const check = (printerId: string, materialId: string) => checkPart({ part: plate, printerId, materialId });

  it("refuses carbon-fibre nylon on a stainless nozzle and an open frame", () => {
    expect(SNAPMAKER_U1.nozzleMaterial).toBe("stainless-steel");
    expect(SNAPMAKER_U1.chamber.enclosed).toBe(false);

    const report = check("snapmaker-u1", "pa-cf");
    expect(findingFor(report, "nozzle-abrasion").severity).toBe("fail");
    expect(findingFor(report, "nozzle-abrasion").fix).toContain("hardened steel nozzle");
    expect(findingFor(report, "chamber-requirement").severity).toBe("fail");
    expect(report.status).toBe("fail");
  });

  it("warns that an enclosed chamber is not a heated one", () => {
    // None of the P1S / P2S / X1C actively heat the chamber, so ABS runs but warps.
    expect(BAMBU_LAB_P1S.chamber).toEqual({ activeHeating: false, maxC: null, enclosed: true });

    const finding = findingFor(check("bambu-p1s", "abs"), "chamber-requirement");
    expect(finding.severity).toBe("warn");
    expect(finding.message).toContain("ACTIVELY HEATED");
  });

  it("passes ABS on the H2D, which does heat its chamber to 65 C", () => {
    expect(findingFor(check("bambu-h2d", "abs"), "chamber-requirement").severity).toBe("pass");
  });

  it("passes an abrasive filament on a hardened nozzle but still warns about the chamber", () => {
    const report = check("bambu-x1c", "pa-cf");
    expect(findingFor(report, "nozzle-abrasion").severity).toBe("pass");
    expect(findingFor(report, "chamber-requirement").severity).toBe("warn");
  });

  it("checks the plate temperature against the machine maximum", () => {
    const finding = findingFor(check("bambu-p1s", "abs"), "bed-temperature");
    expect(finding.measured).toBe(100); // ABS typical
    expect(finding.required).toBe(100); // P1S maximum
    expect(finding.severity).toBe("pass");
  });

  it("says when hole compensation was borrowed rather than measured", () => {
    // Only PLA on a 0.4 mm Bambu nozzle was fitted to a measured part.
    const measured = findingFor(
      checkPart({ part: m3Plate(), printerId: "bambu-x1c", materialId: "pla" }),
      "hole-compensation-calibration",
    );
    expect(measured.severity).toBe("pass");

    const borrowed = findingFor(
      checkPart({ part: m3Plate(), printerId: "bambu-x1c", materialId: "petg" }),
      "hole-compensation-calibration",
    );
    expect(borrowed.severity).toBe("warn");
    expect(borrowed.fix).toContain("coupon");
  });

  it("does not claim a calibration verdict on a part with no holes at all", () => {
    const report = check("bambu-x1c", "pla");
    expect(report.notApplicable).toContain("hole-compensation-calibration");
  });
});

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

describe("report", () => {
  it("passes a well-formed plate and lists the rules that had nothing to check", () => {
    const report = checkPart({ part: m3Plate(), printerId: "bambu-x1c", materialId: "pla" });

    expect(report.status).toBe("pass");
    expect(report.printerId).toBe("bambu-x1c");
    expect(report.nozzleDiameterMm).toBe(0.4);
    expect(report.extrusionWidthMm).toBe(0.42);
    expect(report.notApplicable).toEqual(
      expect.arrayContaining(["insert-depth", "insert-boss-wall", "overhang", "small-feature"]),
    );
    // PLA's shrinkage figure is a typical value, not a vendor specification.
    expect(report.usesUnverifiedProfile).toBe(true);
    expect(report.summary).toContain("passes every check");
    expect(report.summary).toContain("3.62");
  });

  it("gives every finding a feature, a fix, and a measurement where one exists", () => {
    const report = checkPart({
      part: {
        name: "messy plate",
        base: { kind: "plate", widthMm: 60, depthMm: 40, thicknessMm: 0.3 },
        holes: [{ id: "m3Clear", diameterMm: 3.4, pattern: { kind: "explicit", points: [{ xMm: 28, yMm: 0 }] } }],
      },
      printerId: "bambu-x1c",
      materialId: "pla",
    });

    expect(report.status).toBe("fail");
    for (const finding of report.findings) {
      expect(finding.feature.length).toBeGreaterThan(0);
      expect(finding.fix.length).toBeGreaterThan(0);
      expect(finding.message.length).toBeGreaterThan(0);
      if (finding.measured !== null) expect(finding.unit).not.toBeNull();
    }
    expect(describeDfmReport(report)).toContain("DFM FAIL");
  });

  it("names the known ids rather than falling back to a default machine", () => {
    expect(() => checkPart({ part: m3Plate(), printerId: "ender-3", materialId: "pla" })).toThrow(/bambu-x1c/);
    expect(() => checkPart({ part: m3Plate(), printerId: "bambu-x1c", materialId: "nylon" })).toThrow(/pa-cf/);
  });

  it("reuses a geometry the caller already computed instead of regenerating it", () => {
    const part = m3Plate();
    const first = checkPart({ part, printerId: "bambu-x1c", materialId: "pla" });
    const second = checkPart({
      part,
      printerId: "bambu-x1c",
      materialId: "pla",
      geometry: describeModelledPart(part).geometry,
    });
    expect(second.findings).toEqual(first.findings);
    expect(second.bedFit).toEqual(first.bedFit);
  });
});
