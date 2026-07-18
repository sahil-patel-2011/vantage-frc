import { describe, expect, it } from "vitest";
import { evaluateConsumable, sortSpares, summarizeSpares } from "./summary";
import type { Consumable, ConsumableCategory } from "./types";

let seq = 0;
function item(overrides: Partial<Consumable> = {}): Consumable {
  seq += 1;
  return {
    id: `c-${seq}`,
    name: `Item ${seq}`,
    category: "fasteners" as ConsumableCategory,
    unit: "each",
    onHand: 100,
    reorderPoint: 20,
    preferredVendor: null,
    notes: null,
    ...overrides,
  };
}

describe("evaluateConsumable", () => {
  it("is ok above the reorder point", () => {
    expect(evaluateConsumable(item({ onHand: 100, reorderPoint: 20 })).status).toBe("ok");
  });

  it("is low at or below the reorder point", () => {
    expect(evaluateConsumable(item({ onHand: 20, reorderPoint: 20 })).status).toBe("low");
    expect(evaluateConsumable(item({ onHand: 5, reorderPoint: 20 })).status).toBe("low");
  });

  it("is out at zero on-hand", () => {
    expect(evaluateConsumable(item({ onHand: 0, reorderPoint: 20 })).status).toBe("out");
  });

  it("with no reorder point set, only flags when out", () => {
    expect(evaluateConsumable(item({ onHand: 1, reorderPoint: 0 })).status).toBe("ok");
    expect(evaluateConsumable(item({ onHand: 0, reorderPoint: 0 })).status).toBe("out");
  });
});

describe("summarizeSpares", () => {
  it("is all-zero for none", () => {
    const s = summarizeSpares([]);
    expect(s.total).toBe(0);
    expect(s.reorderList).toEqual([]);
  });

  it("counts ok / low / out", () => {
    const s = summarizeSpares([
      item({ onHand: 100, reorderPoint: 20 }), // ok
      item({ onHand: 10, reorderPoint: 20 }), // low
      item({ onHand: 0, reorderPoint: 20 }), // out
    ]);
    expect(s.ok).toBe(1);
    expect(s.low).toBe(1);
    expect(s.out).toBe(1);
    expect(s.total).toBe(3);
  });

  it("orders the reorder list by urgency (out first, then lowest ratio)", () => {
    const s = summarizeSpares([
      item({ name: "half", onHand: 10, reorderPoint: 20 }), // ratio 0.5
      item({ name: "empty", onHand: 0, reorderPoint: 20 }), // ratio 0
      item({ name: "quarter", onHand: 5, reorderPoint: 20 }), // ratio 0.25
      item({ name: "fine", onHand: 100, reorderPoint: 20 }), // ok, excluded
    ]);
    expect(s.reorderList.map((e) => e.item.name)).toEqual(["empty", "quarter", "half"]);
  });

  it("rolls up needs-reorder per category", () => {
    const s = summarizeSpares([
      item({ category: "electrical", onHand: 0, reorderPoint: 5 }),
      item({ category: "electrical", onHand: 100, reorderPoint: 5 }),
      item({ category: "adhesives", onHand: 1, reorderPoint: 3 }),
    ]);
    const elec = s.byCategory.find((c) => c.category === "electrical");
    expect(elec).toEqual({ category: "electrical", total: 2, needsReorder: 1 });
    // adhesives has 1 needing reorder, electrical has 1 — order by needsReorder desc then category order
    expect(s.byCategory[0]?.needsReorder).toBe(1);
  });
});

describe("sortSpares", () => {
  it("surfaces out, then low, then ok", () => {
    const sorted = sortSpares([
      item({ name: "ok", onHand: 100, reorderPoint: 10 }),
      item({ name: "out", onHand: 0, reorderPoint: 10 }),
      item({ name: "low", onHand: 5, reorderPoint: 10 }),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(["out", "low", "ok"]);
  });
});
