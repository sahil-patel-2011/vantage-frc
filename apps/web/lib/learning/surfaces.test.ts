import { describe, expect, it } from "vitest";
import { compoundReduction, outputRpm } from "../gearbox";
import { summarizePower } from "../power-budget";
import { interpolateShot } from "../shooter-table";
import { detectMisconception } from "./predictions";
import { buildGearboxCall, buildPowerBudgetCall, buildShooterCall } from "./surfaces";

function field(set: ReturnType<typeof buildGearboxCall>, key: string) {
  if (set.status !== "ready") throw new Error(`expected ready, got ${set.reason}`);
  const found = set.fields.find((f) => f.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
}

describe("buildGearboxCall", () => {
  const stages = [
    { driving: 14, driven: 50 },
    { driving: 28, driven: 16 },
    { driving: 15, driven: 45 },
  ];

  it("has an honest empty state with no stages", () => {
    const set = buildGearboxCall({ stages: [], motorFreeRpm: 6000 });
    expect(set.status).toBe("unavailable");
  });

  it("takes the truth straight from the existing compoundReduction", () => {
    const set = buildGearboxCall({ stages, motorFreeRpm: null });
    expect(field(set, "reduction").actual).toBe(compoundReduction(stages));
  });

  it("omits output speed until a free speed is entered", () => {
    const set = buildGearboxCall({ stages, motorFreeRpm: null });
    if (set.status !== "ready") throw new Error("expected ready");
    expect(set.fields.map((f) => f.key)).toEqual(["reduction"]);
  });

  it("uses the existing outputRpm for output speed", () => {
    const set = buildGearboxCall({ stages, motorFreeRpm: 6000 });
    expect(field(set, "outputRpm").actual).toBe(outputRpm(6000, compoundReduction(stages)));
  });

  it("catches the inverted-ratio misconception", () => {
    const reduction = compoundReduction(stages);
    const target = field(buildGearboxCall({ stages, motorFreeRpm: null }), "reduction");
    const match = detectMisconception(target.misconceptions, 1 / reduction, reduction);
    expect(match?.id).toBe("inverse");
    expect(match?.explanation).toContain("inverse");
  });

  it("catches adding the stage ratios instead of multiplying them", () => {
    const reduction = compoundReduction(stages);
    const added = stages.reduce((sum, s) => sum + s.driven / s.driving, 0);
    const target = field(buildGearboxCall({ stages, motorFreeRpm: null }), "reduction");
    expect(detectMisconception(target.misconceptions, added, reduction)?.id).toBe("sum");
  });

  it("catches a dropped stage", () => {
    const reduction = compoundReduction(stages);
    const withoutFirst = compoundReduction(stages.slice(1));
    const target = field(buildGearboxCall({ stages, motorFreeRpm: null }), "reduction");
    expect(detectMisconception(target.misconceptions, withoutFirst, reduction)?.id).toBe("dropped:14:50");
  });

  it("catches multiplying instead of dividing on output speed", () => {
    const reduction = compoundReduction(stages);
    const target = field(buildGearboxCall({ stages, motorFreeRpm: 6000 }), "outputRpm");
    const match = detectMisconception(target.misconceptions, 6000 * reduction, target.actual);
    expect(match?.id).toBe("multiplied");
    expect(match?.explanation).toContain("divides speed and multiplies torque");
  });

  it("reconstructs the reduction the student assumed when scoring output speed", () => {
    const target = field(buildGearboxCall({ stages, motorFreeRpm: 6000 }), "outputRpm");
    const terms = target.terms({ reduction: 5 });
    const reductionTerm = terms.find((t) => t.term === "reduction");
    expect(reductionTerm?.assumed).toBe(5);
    expect(reductionTerm?.actual).toBe(compoundReduction(stages));
    expect(reductionTerm?.influence).toBeGreaterThan(0);
  });

  it("leaves the reduction term unassumed when the student did not call it", () => {
    const target = field(buildGearboxCall({ stages, motorFreeRpm: 6000 }), "outputRpm");
    expect(target.terms({}).find((t) => t.term === "reduction")?.assumed).toBeNull();
  });

  it("ranks stages by how far the reduction moves without them", () => {
    const target = field(buildGearboxCall({ stages, motorFreeRpm: null }), "reduction");
    const sorted = [...target.terms({})].sort((a, b) => b.influence - a.influence);
    // Dropping the 28:16 overdrive swings the chain furthest (6.12 → 10.71),
    // further than dropping either reducing stage — that is the real lever.
    expect(sorted[0]!.term).toBe("stage:28:16");
    expect(sorted.map((t) => t.term)).toContain("stage:14:50");
    expect(sorted.every((t) => t.influence > 0)).toBe(true);
  });
});

describe("buildPowerBudgetCall", () => {
  const loads = [
    { name: "Drivetrain", typicalAmps: 40, peakAmps: 120, breakerAmps: 40 },
    { name: "Intake", typicalAmps: 15, peakAmps: 30, breakerAmps: 30 },
    { name: "Elevator", typicalAmps: 25, peakAmps: 60, breakerAmps: 40 },
  ];

  it("has an honest empty state with no loads", () => {
    expect(buildPowerBudgetCall({ loads: [] }).status).toBe("unavailable");
  });

  it("has an honest empty state when no branch has a measured current", () => {
    const set = buildPowerBudgetCall({
      loads: [{ name: "Radio", typicalAmps: null, peakAmps: null, breakerAmps: 20 }],
    });
    expect(set.status).toBe("unavailable");
    if (set.status !== "unavailable") return;
    expect(set.reason).toContain("measure one branch");
  });

  it("takes both totals straight from the existing summarizePower", () => {
    const set = buildPowerBudgetCall({ loads });
    if (set.status !== "ready") throw new Error("expected ready");
    const summary = summarizePower(loads);
    expect(set.fields.find((f) => f.key === "totalTypicalAmps")?.actual).toBe(summary.totalTypicalAmps);
    expect(set.fields.find((f) => f.key === "totalPeakAmps")?.actual).toBe(summary.totalPeakAmps);
  });

  it("catches reading the peak column when asked for the typical one", () => {
    const set = buildPowerBudgetCall({ loads });
    if (set.status !== "ready") throw new Error("expected ready");
    const typical = set.fields.find((f) => f.key === "totalTypicalAmps")!;
    const summary = summarizePower(loads);
    expect(detectMisconception(typical.misconceptions, summary.totalPeakAmps, typical.actual)?.id).toBe(
      "peak_column",
    );
  });

  it("catches naming the biggest single branch instead of the sum", () => {
    const set = buildPowerBudgetCall({ loads });
    if (set.status !== "ready") throw new Error("expected ready");
    const typical = set.fields.find((f) => f.key === "totalTypicalAmps")!;
    expect(detectMisconception(typical.misconceptions, 40, typical.actual)?.id).toBe("biggest_branch");
  });

  it("makes the biggest branch the dominant term", () => {
    const set = buildPowerBudgetCall({ loads });
    if (set.status !== "ready") throw new Error("expected ready");
    const terms = set.fields.find((f) => f.key === "totalTypicalAmps")!.terms({});
    expect([...terms].sort((a, b) => b.influence - a.influence)[0]!.term).toBe("load:Drivetrain");
  });

  it("only counts branches that actually logged a figure", () => {
    const set = buildPowerBudgetCall({
      loads: [...loads, { name: "Unmeasured", typicalAmps: null, peakAmps: null, breakerAmps: null }],
    });
    if (set.status !== "ready") throw new Error("expected ready");
    const terms = set.fields.find((f) => f.key === "totalTypicalAmps")!.terms({});
    expect(terms.map((t) => t.term)).not.toContain("load:Unmeasured");
  });
});

describe("buildShooterCall", () => {
  const points = [
    { distanceFt: 8, rpm: 3000, hoodAngle: 20 },
    { distanceFt: 12, rpm: 3400, hoodAngle: 28 },
    { distanceFt: 18, rpm: 4000, hoodAngle: 40 },
  ];

  it("needs a distance before there is anything to call", () => {
    expect(buildShooterCall({ points, distanceFt: 0 }).status).toBe("unavailable");
  });

  it("needs two calibrated points to interpolate between", () => {
    const set = buildShooterCall({ points: [{ distanceFt: 10, rpm: 3200, hoodAngle: 25 }], distanceFt: 12 });
    expect(set.status).toBe("unavailable");
    if (set.status !== "unavailable") return;
    expect(set.reason).toContain("two calibrated points");
  });

  it("takes the truth straight from the existing interpolateShot", () => {
    const set = buildShooterCall({ points, distanceFt: 14 });
    if (set.status !== "ready") throw new Error("expected ready");
    const shot = interpolateShot(points, 14);
    expect(set.fields.find((f) => f.key === "rpm")?.actual).toBe(shot.rpm);
    expect(set.fields.find((f) => f.key === "hoodAngle")?.actual).toBe(shot.hoodAngle);
  });

  it("catches snapping to the nearest calibrated point", () => {
    const set = buildShooterCall({ points, distanceFt: 13 });
    if (set.status !== "ready") throw new Error("expected ready");
    const rpm = set.fields.find((f) => f.key === "rpm")!;
    expect(detectMisconception(rpm.misconceptions, 3400, rpm.actual)?.id).toBe("nearest_point");
  });

  it("weights the bracketing points by distance", () => {
    const set = buildShooterCall({ points, distanceFt: 13 });
    if (set.status !== "ready") throw new Error("expected ready");
    const terms = set.fields.find((f) => f.key === "rpm")!.terms({});
    expect(terms.map((t) => t.term)).toEqual(["point:12", "point:18"]);
    // 13 ft sits 1/6 of the way from 12 to 18, so the 12 ft point dominates.
    expect(terms[0]!.influence).toBeGreaterThan(terms[1]!.influence);
    expect(terms[0]!.label).toContain("83% of the read");
  });

  it("says plainly when the distance is outside the calibrated range", () => {
    const set = buildShooterCall({ points, distanceFt: 30 });
    if (set.status !== "ready") throw new Error("expected ready");
    const rpm = set.fields.find((f) => f.key === "rpm")!;
    expect(rpm.note).toContain("clamps");
    // Clamping IS reading the nearest point, so that is not a misconception here.
    expect(rpm.misconceptions).toHaveLength(0);
  });

  it("skips a field the table has not calibrated", () => {
    const rpmOnly = [
      { distanceFt: 8, rpm: 3000, hoodAngle: null },
      { distanceFt: 18, rpm: 4000, hoodAngle: null },
    ];
    const set = buildShooterCall({ points: rpmOnly, distanceFt: 12 });
    if (set.status !== "ready") throw new Error("expected ready");
    expect(set.fields.map((f) => f.key)).toEqual(["rpm"]);
  });
});
