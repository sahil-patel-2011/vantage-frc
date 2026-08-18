import { describe, expect, it } from "vitest";
import {
  groupByCategory,
  INSPECTION_TEMPLATE,
  inspectionProgress,
  parseInspectionAction,
  weightStatus,
  type InspectionItem,
  type RobotWeight,
} from "./inspection";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<InspectionItem>): InspectionItem {
  return {
    id: ID,
    robotLabel: "competition",
    category: "Electrical",
    requirement: "Battery secure",
    status: "pending",
    note: "",
    isCustom: false,
    sortOrder: 0,
    checkedByName: null,
    checkedAt: null,
    ...overrides,
  };
}

function weight(overrides: Partial<RobotWeight>): RobotWeight {
  return {
    id: "w1",
    robotLabel: "competition",
    totalLbs: 118.4,
    config: "with bumpers",
    note: "",
    weighedAt: "2026-03-01T12:00:00.000Z",
    recordedByName: null,
    ...overrides,
  };
}

describe("INSPECTION_TEMPLATE", () => {
  it("covers the core FRC inspection areas with unique requirements", () => {
    const categories = INSPECTION_TEMPLATE.map((entry) => entry.category);
    expect(categories).toContain("Chassis & Bumpers");
    expect(categories).toContain("Electrical");
    expect(categories).toContain("Pneumatics");
    const all = INSPECTION_TEMPLATE.flatMap((entry) => entry.items);
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(new Set(all).size).toBe(all.length);
    expect(all.some((item) => /1\.25/i.test(item) && /5 in/i.test(item))).toBe(true);
    expect(all.some((item) => /R409/i.test(item) && /electrical/i.test(item))).toBe(true);
    expect(all.some((item) => /0\.25 in/i.test(item) && /R101/i.test(item))).toBe(true);
    expect(all.some((item) => /36 in/i.test(item) && /RSL/i.test(item))).toBe(true);
    expect(all.some((item) => /solid-core foam/i.test(item) && /hollow/i.test(item))).toBe(true);
    expect(all.some((item) => /reversible/i.test(item))).toBe(true);
    expect(all.some((item) => /115 lb/i.test(item) && /R103/i.test(item))).toBe(true);
    expect(all.some((item) => /135 lb/i.test(item) && /R408/i.test(item))).toBe(true);
    expect(all.some((item) => /150 lb/i.test(item) && /I103/i.test(item))).toBe(true);
    expect(all.some((item) => /60/.test(item) && /16/.test(item) && /78/.test(item))).toBe(true);
    expect(all.some((item) => /unauthorized wireless/i.test(item))).toBe(true);
    expect(all.some((item) => /isolat/i.test(item) && /120/.test(item) && /breaker on/i.test(item))).toBe(true);
    expect(all.some((item) => /relief valve/i.test(item) && /compressor outlet/i.test(item))).toBe(true);
    expect(all.some((item) => /vent plug/i.test(item) && /0 psi/i.test(item))).toBe(true);
    expect(all.some((item) => /3\.5 in/i.test(item) && /R412/i.test(item))).toBe(true);
    expect(all.some((item) => /120 psi/i.test(item) && /60 psi/i.test(item))).toBe(true);
    expect(all.some((item) => /pressure switch/i.test(item) && /PCM\/PH/i.test(item))).toBe(true);
    expect(all.some((item) => /one onboard legal compressor/i.test(item))).toBe(true);
    expect(all.some((item) => /110 in/i.test(item) && /30 in/i.test(item))).toBe(true);
    expect(all.some((item) => /12 in/i.test(item) && /one direction/i.test(item))).toBe(true);
    expect(JSON.stringify(all).toLowerCase()).not.toContain("demo");
  });
});

describe("inspectionProgress", () => {
  it("computes counts, percent, and readiness", () => {
    const progress = inspectionProgress([
      item({ id: "1", status: "pass" }),
      item({ id: "2", status: "na" }),
      item({ id: "3", status: "pending" }),
      item({ id: "4", status: "fail" }),
    ]);
    expect(progress).toMatchObject({ total: 4, pass: 1, na: 1, pending: 1, fail: 1, percent: 50, ready: false });
  });
  it("is ready only when everything passes or is n/a", () => {
    expect(inspectionProgress([item({ status: "pass" }), item({ id: "2", status: "na" })]).ready).toBe(true);
    expect(inspectionProgress([]).ready).toBe(false);
  });
});

describe("weightStatus", () => {
  it("uses the most recent weigh-in and computes the margin", () => {
    const status = weightStatus(
      [weight({ id: "old", totalLbs: 130, weighedAt: "2026-02-01T00:00:00Z" }), weight({ id: "new", totalLbs: 120 })],
      125,
    );
    expect(status.latest?.id).toBe("new");
    expect(status.marginLbs).toBe(5);
    expect(status.over).toBe(false);
  });
  it("flags overweight and handles no data", () => {
    expect(weightStatus([weight({ totalLbs: 127.5 })], 125)).toMatchObject({ marginLbs: -2.5, over: true });
    expect(weightStatus([], 125)).toEqual({ latest: null, marginLbs: null, over: false });
  });
});

describe("groupByCategory", () => {
  it("orders groups by template order with unknown categories last", () => {
    const groups = groupByCategory([
      item({ id: "1", category: "General & Safety" }),
      item({ id: "2", category: "Chassis & Bumpers" }),
      item({ id: "3", category: "Game-specific" }),
    ]);
    expect(groups.map((group) => group.category)).toEqual(["Chassis & Bumpers", "General & Safety", "Game-specific"]);
  });
});

describe("parseInspectionAction", () => {
  it("defaults robot label to competition", () => {
    expect(parseInspectionAction({ action: "seed_checklist", orgId: ORG })).toMatchObject({ robotLabel: "competition" });
  });
  it("validates status transitions and weights", () => {
    expect(parseInspectionAction({ action: "set_status", orgId: ORG, id: ID, status: "pass" })).toMatchObject({ status: "pass" });
    expect(() => parseInspectionAction({ action: "set_status", orgId: ORG, id: ID, status: "maybe" })).toThrow(/Invalid inspection status/);
    expect(parseInspectionAction({ action: "log_weight", orgId: ORG, totalLbs: "118.42" })).toMatchObject({ totalLbs: 118.42 });
    expect(() => parseInspectionAction({ action: "log_weight", orgId: ORG, totalLbs: 0 })).toThrow(/between 0 and 1000/);
    expect(() => parseInspectionAction({ action: "set_weight_limit", orgId: ORG, weightLimitLbs: -1 })).toThrow(/between 0 and 1000/);
  });
  it("requires category and requirement for custom items", () => {
    expect(() => parseInspectionAction({ action: "add_item", orgId: ORG, category: "", requirement: "x" })).toThrow(/Category is required/);
    expect(parseInspectionAction({ action: "add_item", orgId: ORG, category: "Game-specific", requirement: "Note limit" })).toMatchObject({
      category: "Game-specific",
    });
  });
  it("rejects unsupported actions", () => {
    expect(() => parseInspectionAction({ action: "certify", orgId: ORG })).toThrow(/Unsupported/);
  });
});
