import { describe, expect, it } from "vitest";
import { classifyBattery, computeReleaseGate, parsePitAction } from "./pit-operations";
const orgId = "11111111-1111-4111-8111-111111111111";
describe("pit operations", () => {
  it("normalizes battery input", () => expect(parsePitAction({ action: "log_battery", orgId, assetTag: " comp-04 ", voltage: "12.78" })).toMatchObject({ assetTag: "COMP-04", voltage: 12.78 }));
  it("requires a battery measurement", () => expect(() => parsePitAction({ action: "log_battery", orgId, assetTag: "A1" })).toThrow("Enter at least one battery measurement"));
  it("classifies battery evidence", () => {
    const measuredAt = "2026-09-26T12:00:00Z", now = Date.parse("2026-09-26T12:01:00Z");
    expect(classifyBattery({ status: "active", voltage: 12.7, resistanceMilliohms: 10, measuredAt, now })).toBe("ready");
    expect(classifyBattery({ status: "active", voltage: 12.1, resistanceMilliohms: 10, measuredAt, now })).toBe("review");
    expect(classifyBattery({ status: "active", voltage: 12.7, resistanceMilliohms: 19, measuredAt, now })).toBe("review");
    expect(classifyBattery({ status: "active", voltage: 12.7, resistanceMilliohms: 10, now })).toBe("review");
  });
  it("holds for disabled issues", () => expect(computeReleaseGate({ safetyIssues: 0, disabledIssues: 1, overdueMaintenance: 0, readyBatteries: 2, activeBatteries: 3 }).state).toBe("hold"));
  it("checks incomplete evidence without inventing a percentage", () => expect(computeReleaseGate({ safetyIssues: 0, disabledIssues: 0, overdueMaintenance: 1, readyBatteries: 0, activeBatteries: 2 }).state).toBe("check"));
});
