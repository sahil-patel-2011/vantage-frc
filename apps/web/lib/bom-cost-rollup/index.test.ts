import { describe, expect, it } from "vitest";
import { summarizeBom } from "./index";
import type { BomLineItem } from "./types";

function item(overrides: Partial<BomLineItem> = {}): BomLineItem {
  return {
    id: "item-1",
    partName: "Plate",
    subsystem: "Drivetrain",
    category: "raw_material",
    quantity: 2,
    unitCostUsd: 45,
    lineTotalUsd: 90,
    source: "manual",
    cadReference: null,
    seasonYear: 2026,
    notes: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeBom", () => {
  it("never invents a DEMO percent when no season budget is set", () => {
    const summary = summarizeBom([item({ lineTotalUsd: 240 })], 0);
    expect(summary.totalCostUsd).toBe(240);
    expect(summary.budgetUsd).toBe(0);
    expect(summary.percentUsed).toBeNull();
    expect(summary.status).toBe("under");
  });

  it("computes percent only against a real positive budget", () => {
    const summary = summarizeBom([item({ lineTotalUsd: 80 })], 200);
    expect(summary.percentUsed).toBe(0.4);
    expect(summary.remainingUsd).toBe(120);
    expect(summary.status).toBe("under");
  });
});
