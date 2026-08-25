import { describe, expect, it } from "vitest";
import {
  applyAdjustment,
  applyConsumption,
  isLowStock,
  netQuantity,
  pendingBackfill,
  type LedgerState,
} from "./ledger";

const empty = (): LedgerState => ({ entries: [], quantity: 0 });

describe("applyAdjustment — ledger-not-update invariant", () => {
  it("two adjustments append two rows and the net quantity is right", () => {
    let state = empty();
    state = applyAdjustment(state, { delta: 10, reason: "received", note: "Order arrived" });
    state = applyAdjustment(state, { delta: -3, reason: "used" });

    expect(state.entries).toHaveLength(2);
    expect(state.quantity).toBe(7);
    // The quantity column is always the ledger's net — never a bare write.
    expect(netQuantity(state.entries)).toBe(state.quantity);
    expect(state.entries.map((e) => e.delta)).toEqual([10, -3]);
  });

  it("never mutates the previous state (append-only history)", () => {
    const before = empty();
    applyAdjustment(before, { delta: 5 });
    expect(before.entries).toHaveLength(0);
    expect(before.quantity).toBe(0);
  });

  it("rejects a movement that would take stock below zero", () => {
    const state = applyAdjustment(empty(), { delta: 2 });
    expect(() => applyAdjustment(state, { delta: -3 })).toThrow(/below zero/);
  });

  it("rejects a zero delta — no ghost ledger rows", () => {
    expect(() => applyAdjustment(empty(), { delta: 0 })).toThrow(/non-zero/);
  });
});

describe("applyConsumption — sourceRef idempotency", () => {
  it("decrements through the ledger with the source reference attached", () => {
    let state = applyAdjustment(empty(), { delta: 4, reason: "received" });
    state = applyConsumption(state, {
      quantity: 1,
      sourceKind: "pit_repair_triage",
      sourceId: "repair-1",
      note: "Swapped intake roller",
    });

    expect(state.quantity).toBe(3);
    const row = state.entries.at(-1)!;
    expect(row).toMatchObject({
      delta: -1,
      reason: "used",
      sourceKind: "pit_repair_triage",
      sourceId: "repair-1",
    });
  });

  it("replaying the same source does not double-decrement", () => {
    let state = applyAdjustment(empty(), { delta: 4, reason: "received" });
    const consume = { quantity: 1, sourceKind: "pit_repair_triage", sourceId: "repair-1" };
    state = applyConsumption(state, consume);
    const replayed = applyConsumption(state, consume);

    expect(replayed).toBe(state);
    expect(replayed.entries).toHaveLength(2);
    expect(replayed.quantity).toBe(3);
  });

  it("clamps to what is on hand so the ledger stays truthful", () => {
    let state = applyAdjustment(empty(), { delta: 2, reason: "received" });
    state = applyConsumption(state, { quantity: 5, sourceKind: "pit_repair_triage", sourceId: "r2" });
    expect(state.quantity).toBe(0);
    expect(state.entries.at(-1)!.delta).toBe(-2);
    expect(netQuantity(state.entries)).toBe(0);
  });

  it("records nothing when nothing is on hand", () => {
    const state = empty();
    const after = applyConsumption(state, { quantity: 1, sourceKind: "pit_repair_triage", sourceId: "r3" });
    expect(after.entries).toHaveLength(0);
    expect(after.quantity).toBe(0);
  });
});

describe("pendingBackfill — idempotent dedup", () => {
  const candidates = [
    { legacyId: "a", name: "M3 screws" },
    { legacyId: "b", name: "Wire 12AWG" },
    { legacyId: "b", name: "Wire 12AWG (dupe row)" },
  ];

  it("first run migrates each legacy row exactly once", () => {
    const pending = pendingBackfill([], candidates);
    expect(pending.map((c) => c.legacyId)).toEqual(["a", "b"]);
  });

  it("second run yields zero new rows", () => {
    const migrated = pendingBackfill([], candidates).map((c) => c.legacyId);
    expect(pendingBackfill(migrated, candidates)).toHaveLength(0);
  });

  it("partial prior migration only carries the remainder", () => {
    expect(pendingBackfill(["a"], candidates).map((c) => c.legacyId)).toEqual(["b"]);
  });
});

describe("isLowStock — threshold edges", () => {
  it("reorder level 0 never flags, even when out of stock", () => {
    expect(isLowStock(0, 0)).toBe(false);
    expect(isLowStock(5, 0)).toBe(false);
  });

  it("null/undefined reorder level never flags", () => {
    expect(isLowStock(0, null)).toBe(false);
    expect(isLowStock(0, undefined)).toBe(false);
  });

  it("flags at or below a positive reorder level", () => {
    expect(isLowStock(3, 3)).toBe(true);
    expect(isLowStock(0, 3)).toBe(true);
    expect(isLowStock(4, 3)).toBe(false);
  });
});
