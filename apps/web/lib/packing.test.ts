import { describe, expect, it } from "vitest";
import {
  groupPacking,
  packProgress,
  PACKING_TEMPLATE,
  parsePackingAction,
  type PackingItem,
} from "./packing";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<PackingItem>): PackingItem {
  return {
    id: "i1",
    listId: ID,
    category: "Batteries & Power",
    label: "Competition batteries (charged)",
    quantity: 6,
    packed: false,
    packedByName: null,
    packedAt: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("PACKING_TEMPLATE", () => {
  it("covers the core load-out areas with unique labels", () => {
    const categories = PACKING_TEMPLATE.map((entry) => entry.category);
    expect(categories).toContain("Batteries & Power");
    expect(categories).toContain("Tools & Pit");
    const labels = PACKING_TEMPLATE.flatMap((entry) => entry.items.map((entryItem) => entryItem.label));
    expect(labels.length).toBeGreaterThanOrEqual(20);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("packProgress", () => {
  it("computes percent and done", () => {
    expect(packProgress([item({ packed: true }), item({ id: "b", packed: false })])).toMatchObject({
      total: 2,
      packed: 1,
      percent: 50,
      done: false,
    });
    expect(packProgress([item({ packed: true })]).done).toBe(true);
    expect(packProgress([]).done).toBe(false);
  });
});

describe("groupPacking", () => {
  it("orders template categories first, unknown last", () => {
    const groups = groupPacking([
      item({ id: "1", category: "Snacks Extra" }),
      item({ id: "2", category: "Robot & Spares" }),
      item({ id: "3", category: "Team & Safety" }),
    ]);
    expect(groups.map((group) => group.category)).toEqual(["Robot & Spares", "Team & Safety", "Snacks Extra"]);
  });
});

describe("parsePackingAction", () => {
  it("creates a list with template seeding on by default", () => {
    expect(parsePackingAction({ action: "create_list", orgId: ORG, title: "Week 1 Regional" })).toMatchObject({
      action: "create_list",
      seedTemplate: true,
      eventKey: null,
    });
    expect(parsePackingAction({ action: "create_list", orgId: ORG, title: "x", seedTemplate: false })).toMatchObject({
      seedTemplate: false,
    });
  });
  it("validates item quantity as a positive integer", () => {
    expect(parsePackingAction({ action: "add_item", orgId: ORG, listId: ID, label: "Gaffer tape" })).toMatchObject({ quantity: 1 });
    expect(() => parsePackingAction({ action: "add_item", orgId: ORG, listId: ID, label: "x", quantity: 2.5 })).toThrow(/whole number/);
    expect(() => parsePackingAction({ action: "add_item", orgId: ORG, listId: ID, label: "x", quantity: 0 })).toThrow(/whole number/);
  });
  it("toggles and rejects unsupported actions", () => {
    expect(parsePackingAction({ action: "toggle_item", orgId: ORG, id: ID, packed: true })).toMatchObject({ packed: true });
    expect(() => parsePackingAction({ action: "vanish", orgId: ORG })).toThrow(/Unsupported/);
  });
});
