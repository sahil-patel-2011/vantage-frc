import { describe, expect, it } from "vitest";
import { computeFreeSpeedFps, motorFreeRpm, parseSubsystemAction, validateSubsystem } from "./subsystems";

describe("motorFreeRpm", () => {
  it("looks up known motors and returns null for unknown", () => {
    expect(motorFreeRpm("neo")).toBe(5676);
    expect(motorFreeRpm("krakenx60")).toBe(6000);
    expect(motorFreeRpm("mystery")).toBeNull();
  });
});

describe("computeFreeSpeedFps", () => {
  it("computes a realistic swerve free speed (NEO, 6.75:1, 4in wheel ≈ 14.7 ft/s)", () => {
    const fps = computeFreeSpeedFps(5676, 6.75, 4);
    expect(fps).not.toBeNull();
    expect(fps as number).toBeCloseTo(14.67, 1);
  });
  it("returns null when any input is missing or non-positive", () => {
    expect(computeFreeSpeedFps(null, 6.75, 4)).toBeNull();
    expect(computeFreeSpeedFps(5676, 0, 4)).toBeNull();
    expect(computeFreeSpeedFps(5676, 6.75, -4)).toBeNull();
  });
  it("goes faster with a lower reduction", () => {
    const slow = computeFreeSpeedFps(6000, 8, 4)!;
    const fast = computeFreeSpeedFps(6000, 5, 4)!;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe("validateSubsystem", () => {
  it("requires a name and valid category", () => {
    expect(validateSubsystem({ category: "drivetrain" }).ok).toBe(false);
    expect(validateSubsystem({ name: "Drive", category: "spaceship" }).ok).toBe(false);
  });
  it("rejects non-positive gear reduction and wheel diameter", () => {
    expect(validateSubsystem({ name: "Drive", category: "drivetrain", gearReduction: 0 }).ok).toBe(false);
    expect(validateSubsystem({ name: "Drive", category: "drivetrain", wheelDiameterIn: -1 }).ok).toBe(false);
  });
  it("rejects a fractional motor count", () => {
    expect(validateSubsystem({ name: "Drive", category: "drivetrain", motorCount: 2.5 }).ok).toBe(false);
  });
  it("accepts a valid drivetrain spec", () => {
    const result = validateSubsystem({ name: "Swerve", category: "drivetrain", motorType: "neo", motorCount: 4, gearReduction: 6.75, wheelDiameterIn: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.gearReduction).toBe(6.75);
  });
});

describe("parseSubsystemAction", () => {
  it("parses create_subsystem with a season year", () => {
    const action = parseSubsystemAction({ action: "create_subsystem", orgId: "o1", seasonYear: 2026, name: "Swerve", category: "drivetrain" });
    expect(action).toMatchObject({ action: "create_subsystem", name: "Swerve" });
  });
  it("rejects create_subsystem without a season year", () => {
    expect(() => parseSubsystemAction({ action: "create_subsystem", orgId: "o1", name: "Swerve", category: "drivetrain" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseSubsystemAction({ action: "explode", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
