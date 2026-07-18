import { describe, expect, it } from "vitest";
import {
  canTransitionOrder,
  computeOrderMetrics,
  summarizeOpenOrders,
  validateOrderSubmit,
} from "./evaluate";
import type { OrderRequest } from "./types";

function base(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    id: "o1",
    seasonYear: 2026,
    title: "Aluminum stock",
    justification: "Chassis rails",
    vendor: "McMaster",
    itemUrl: "https://example.com/part",
    quantity: 2,
    unitCostUsd: 25,
    totalCostUsd: 50,
    status: "pending",
    neededBy: null,
    requestedBy: "u1",
    requestedByName: "Alex",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    buyerUserId: null,
    buyerName: null,
    orderedAt: null,
    receivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("order evaluate helpers", () => {
  it("validates submit fields", () => {
    const ok = validateOrderSubmit({
      title: "Bearings",
      justification: "Swerve modules need fresh bearings before district.",
      estimateUsd: 42.5,
      vendor: "VEX",
      itemUrl: "https://www.vexrobotics.com/bearing",
      quantity: 4,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.title).toBe("Bearings");
      expect(ok.value.estimateUsd).toBe(42.5);
      expect(ok.value.quantity).toBe(4);
    }

    const bad = validateOrderSubmit({ title: "", justification: "x" });
    expect(bad.ok).toBe(false);
  });

  it("ignores card and bank fields — never part of validation", () => {
    const result = validateOrderSubmit({
      title: "Wire kit",
      justification: "Pit spare harness",
      estimateUsd: 18,
      cardNumber: "4111111111111111",
      cvv: "123",
      bankAccount: "987654321",
      cardExpiry: "12/29",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("cardNumber");
      expect(result.value).not.toHaveProperty("cvv");
      expect(result.value).not.toHaveProperty("bankAccount");
    }
  });

  it("enforces status transitions", () => {
    expect(canTransitionOrder("pending", "approved")).toBe(true);
    expect(canTransitionOrder("pending", "rejected")).toBe(true);
    expect(canTransitionOrder("approved", "ordered")).toBe(true);
    expect(canTransitionOrder("ordered", "received")).toBe(true);
    expect(canTransitionOrder("pending", "ordered")).toBe(false);
    expect(canTransitionOrder("rejected", "approved")).toBe(false);
  });

  it("computes metrics from real rows only", () => {
    const metrics = computeOrderMetrics(
      [
        base({ id: "1", status: "pending", totalCostUsd: 50, requestedBy: "me" }),
        base({ id: "2", status: "approved", totalCostUsd: 30, buyerUserId: "me" }),
        base({ id: "3", status: "ordered" }),
        base({ id: "4", status: "rejected" }),
      ],
      "me",
    );
    expect(metrics).toMatchObject({
      pending: 1,
      approved: 1,
      readyToBuy: 1,
      ordered: 1,
      rejected: 1,
      openTotalUsd: 80,
      minePending: 1,
      mineToBuy: 1,
    });
  });

  it("summarizes open orders for finance assist", () => {
    const empty = summarizeOpenOrders([]);
    expect(empty.openCount).toBe(0);
    expect(empty.recommendations.length).toBeGreaterThan(0);

    const summary = summarizeOpenOrders([
      base({ status: "pending", totalCostUsd: 120 }),
      base({ id: "o2", status: "approved", itemUrl: null, buyerUserId: null }),
    ]);
    expect(summary.openCount).toBe(2);
    expect(summary.openTotalUsd).toBe(170);
    expect(summary.headline).toMatch(/awaiting approval/i);
    expect(summary.recommendations.some((line) => /vendor link/i.test(line))).toBe(true);
    expect(summary.recommendations.some((line) => /Assign a buyer/i.test(line))).toBe(true);
  });
});
