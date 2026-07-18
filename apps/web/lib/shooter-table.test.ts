import { describe, expect, it } from "vitest";
import { interpolateShot, parseShooterAction, summarizeTable, validatePoint } from "./shooter-table";

describe("validatePoint", () => {
  it("requires a positive distance", () => {
    expect(validatePoint({ distanceFt: 0, rpm: 3000 }).ok).toBe(false);
  });
  it("requires at least one of rpm or hood angle", () => {
    expect(validatePoint({ distanceFt: 10 }).ok).toBe(false);
  });
  it("accepts a valid point", () => {
    const result = validatePoint({ distanceFt: 10, rpm: 3000, hoodAngle: 45 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rpm).toBe(3000);
  });
});

describe("interpolateShot", () => {
  const points = [
    { distanceFt: 5, rpm: 2000, hoodAngle: 30 },
    { distanceFt: 10, rpm: 3000, hoodAngle: 40 },
    { distanceFt: 15, rpm: 4000, hoodAngle: 50 },
  ];
  it("interpolates linearly between calibrated points", () => {
    const shot = interpolateShot(points, 7.5);
    expect(shot.rpm).toBe(2500); // halfway between 2000 and 3000
    expect(shot.hoodAngle).toBe(35);
    expect(shot.extrapolated).toBe(false);
  });
  it("returns exact values at a calibrated point", () => {
    expect(interpolateShot(points, 10).rpm).toBe(3000);
  });
  it("clamps and flags extrapolation outside the calibrated range", () => {
    const near = interpolateShot(points, 2);
    expect(near.rpm).toBe(2000);
    expect(near.extrapolated).toBe(true);
    const far = interpolateShot(points, 20);
    expect(far.rpm).toBe(4000);
    expect(far.extrapolated).toBe(true);
  });
  it("interpolates each field only over points that define it", () => {
    const mixed = [
      { distanceFt: 5, rpm: 2000, hoodAngle: null },
      { distanceFt: 15, rpm: 4000, hoodAngle: 50 },
    ];
    const shot = interpolateShot(mixed, 10);
    expect(shot.rpm).toBe(3000);
    expect(shot.hoodAngle).toBe(50); // only one angle point -> clamps to it
  });
});

describe("summarizeTable", () => {
  it("reports count and distance range", () => {
    const summary = summarizeTable([
      { distanceFt: 10, rpm: 3000, hoodAngle: null },
      { distanceFt: 5, rpm: 2000, hoodAngle: null },
    ]);
    expect(summary.count).toBe(2);
    expect(summary.minDistanceFt).toBe(5);
    expect(summary.maxDistanceFt).toBe(10);
  });
});

describe("parseShooterAction", () => {
  it("parses save_point with a season year and default table name", () => {
    const action = parseShooterAction({ action: "save_point", orgId: "o1", seasonYear: 2026, distanceFt: 10, rpm: 3000 });
    expect(action).toMatchObject({ action: "save_point", tableName: "Shooter", distanceFt: 10 });
  });
  it("rejects an unsupported action", () => {
    expect(() => parseShooterAction({ action: "misfire", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
