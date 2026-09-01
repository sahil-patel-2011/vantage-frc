import { describe, expect, it, vi } from "vitest";
import {
  INVENTORY_ITEM_ID_INVALID,
  NEEDED_BY_INVALID,
  VENDOR_ID_REQUIRED,
  VENDOR_NOT_IN_DIRECTORY,
  insertDirectoryPurchaseRequest,
  updateDirectoryPurchaseRequest,
  validatePurchaseRequestCreate,
} from "./purchase-request";

const VENDOR_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "NEO 550",
    vendorId: VENDOR_ID,
    quantity: 2,
    unitCostUsd: 10,
    justification: "Drivetrain spare",
    ...overrides,
  };
}

describe("validatePurchaseRequestCreate — vendor id required", () => {
  it("rejects a missing vendor id", () => {
    const result = validatePurchaseRequestCreate({ title: "Gearbox", quantity: 1, unitCostUsd: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(VENDOR_ID_REQUIRED);
  });

  it("rejects an empty vendor id", () => {
    expect(validatePurchaseRequestCreate(validBody({ vendorId: "" })).ok).toBe(false);
    expect(validatePurchaseRequestCreate(validBody({ vendorId: "   " })).ok).toBe(false);
  });

  it("rejects a free-text vendor name in place of a directory id", () => {
    const byName = validatePurchaseRequestCreate({
      title: "Shaft stock",
      quantity: 1,
      unitCostUsd: 12,
      vendor: "McMaster",
    });
    expect(byName.ok).toBe(false);
    if (!byName.ok) expect(byName.error).toBe(VENDOR_ID_REQUIRED);

    const nameAsId = validatePurchaseRequestCreate(validBody({ vendorId: "Amazon" }));
    expect(nameAsId.ok).toBe(false);
    if (!nameAsId.ok) expect(nameAsId.error).toBe(VENDOR_ID_REQUIRED);
  });

  it("ignores a free-text vendor field when a directory id is present", () => {
    const result = validatePurchaseRequestCreate(validBody({ vendor: "whoever" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vendorId).toBe(VENDOR_ID);
      expect(result.value).not.toHaveProperty("vendor");
    }
  });

  it("accepts a directory vendor id and computes total cost", () => {
    const result = validatePurchaseRequestCreate(validBody());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vendorId).toBe(VENDOR_ID);
      expect(result.value.totalCostUsd).toBe(20);
      expect(result.value.neededBy).toBeNull();
      expect(result.value.inventoryItemId).toBeNull();
    }
  });

  it("accepts vendor_id as an alias and estimateUsd as unit cost", () => {
    const result = validatePurchaseRequestCreate({
      title: "Bearings",
      vendor_id: VENDOR_ID,
      estimateUsd: 42.5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vendorId).toBe(VENDOR_ID);
      expect(result.value.quantity).toBe(1);
      expect(result.value.unitCostUsd).toBe(42.5);
    }
  });
});

describe("validatePurchaseRequestCreate — neededBy", () => {
  it("accepts a YYYY-MM-DD neededBy and the needed_by alias", () => {
    const byCamel = validatePurchaseRequestCreate(validBody({ neededBy: "2026-10-12" }));
    expect(byCamel.ok).toBe(true);
    if (byCamel.ok) expect(byCamel.value.neededBy).toBe("2026-10-12");

    const bySnake = validatePurchaseRequestCreate(validBody({ needed_by: "2026-11-01" }));
    expect(bySnake.ok).toBe(true);
    if (bySnake.ok) expect(bySnake.value.neededBy).toBe("2026-11-01");
  });

  it("treats a blank neededBy as null", () => {
    const empty = validatePurchaseRequestCreate(validBody({ neededBy: "" }));
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.neededBy).toBeNull();

    const spaces = validatePurchaseRequestCreate(validBody({ neededBy: "   " }));
    expect(spaces.ok).toBe(true);
    if (spaces.ok) expect(spaces.value.neededBy).toBeNull();
  });

  it("accepts an optional inventoryItemId and the inventory_item_id alias", () => {
    const ITEM_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const byCamel = validatePurchaseRequestCreate(validBody({ inventoryItemId: ITEM_ID }));
    expect(byCamel.ok).toBe(true);
    if (byCamel.ok) expect(byCamel.value.inventoryItemId).toBe(ITEM_ID);

    const bySnake = validatePurchaseRequestCreate(validBody({ inventory_item_id: ITEM_ID }));
    expect(bySnake.ok).toBe(true);
    if (bySnake.ok) expect(bySnake.value.inventoryItemId).toBe(ITEM_ID);

    const blank = validatePurchaseRequestCreate(validBody({ inventoryItemId: "" }));
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.value.inventoryItemId).toBeNull();
  });

  it("rejects a non-uuid inventoryItemId instead of inventing a catalog link", () => {
    const result = validatePurchaseRequestCreate(validBody({ inventoryItemId: "NEO-550" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(INVENTORY_ITEM_ID_INVALID);
  });

  it("rejects a non-date neededBy instead of inventing or dropping it", () => {
    const result = validatePurchaseRequestCreate(validBody({ neededBy: "asap" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(NEEDED_BY_INVALID);
  });
});

describe("insertDirectoryPurchaseRequest", () => {
  it("refuses create when the vendor id is not in the directory", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      insertDirectoryPurchaseRequest({ query } as never, {
        orgId: ORG_ID,
        userId: USER_ID,
        seasonYear: 2026,
        body: validBody(),
      }),
    ).rejects.toThrow(VENDOR_NOT_IN_DIRECTORY);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("inserts vendor_id and the directory name — never the free-text field", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: VENDOR_ID, name: "McMaster-Carr", preferred: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: "req-1", title: "NEO 550", vendor: "McMaster-Carr", vendorId: VENDOR_ID }],
      });

    const created = await insertDirectoryPurchaseRequest({ query } as never, {
      orgId: ORG_ID,
      userId: USER_ID,
      seasonYear: 2026,
      body: validBody({ vendor: "Amazon" }),
    });

    expect(created.vendorId).toBe(VENDOR_ID);
    expect(created.vendor).toBe("McMaster-Carr");
    const insertCall = query.mock.calls[1];
    expect(insertCall?.[0]).toMatch(/INSERT INTO purchase_requests/);
    expect(insertCall?.[0]).toMatch(/vendor_id/);
    expect(insertCall?.[1]).toEqual([
      ORG_ID,
      2026,
      null,
      USER_ID,
      "NEO 550",
      "McMaster-Carr",
      VENDOR_ID,
      null,
      2,
      10,
      20,
      "Drivetrain spare",
      null,
      null,
    ]);
    expect(insertCall?.[1]).not.toContain("Amazon");
  });

  it("writes inventory_item_id when the buy sheet names a catalog row", async () => {
    const ITEM_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: VENDOR_ID, name: "McMaster-Carr", preferred: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: "req-3", title: "NEO 550", vendor: "McMaster-Carr", vendorId: VENDOR_ID, inventoryItemId: ITEM_ID }],
      });

    const created = await insertDirectoryPurchaseRequest({ query } as never, {
      orgId: ORG_ID,
      userId: USER_ID,
      seasonYear: 2026,
      body: validBody({ inventoryItemId: ITEM_ID }),
    });

    expect(created.inventoryItemId).toBe(ITEM_ID);
    const insertCall = query.mock.calls[1];
    expect(insertCall?.[0]).toMatch(/inventory_item_id/);
    expect(insertCall?.[1]?.[13]).toBe(ITEM_ID);
  });

  it("writes needed_by when the buy sheet sends a date", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: VENDOR_ID, name: "McMaster-Carr", preferred: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: "req-2", title: "NEO 550", vendor: "McMaster-Carr", vendorId: VENDOR_ID, neededBy: "2026-10-12" }],
      });

    const created = await insertDirectoryPurchaseRequest({ query } as never, {
      orgId: ORG_ID,
      userId: USER_ID,
      seasonYear: 2026,
      body: validBody({ neededBy: "2026-10-12" }),
    });

    expect(created.neededBy).toBe("2026-10-12");
    const insertCall = query.mock.calls[1];
    expect(insertCall?.[0]).toMatch(/needed_by/);
    expect(insertCall?.[1]?.[12]).toBe("2026-10-12");
  });
});

describe("updateDirectoryPurchaseRequest", () => {
  const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

  it("writes vendor_id and the directory name — never the free-text field", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: VENDOR_ID, name: "McMaster-Carr", preferred: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: REQUEST_ID, status: "pending", vendorId: VENDOR_ID }],
      });

    const updated = await updateDirectoryPurchaseRequest({ query } as never, {
      orgId: ORG_ID,
      id: REQUEST_ID,
      body: validBody({ vendor: "Amazon" }),
    });

    expect(updated.vendorId).toBe(VENDOR_ID);
    expect(updated.vendor).toBe("McMaster-Carr");
    const updateCall = query.mock.calls[1];
    expect(updateCall?.[0]).toMatch(/UPDATE purchase_requests/);
    expect(updateCall?.[0]).toMatch(/vendor_id=\$3/);
    expect(updateCall?.[1]).toEqual([
      "NEO 550",
      "McMaster-Carr",
      VENDOR_ID,
      null,
      2,
      10,
      20,
      "Drivetrain spare",
      null,
      null,
      null,
      REQUEST_ID,
      ORG_ID,
    ]);
    expect(updateCall?.[1]).not.toContain("Amazon");
  });

  it("writes needed_by on edit", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: VENDOR_ID, name: "McMaster-Carr", preferred: true }] })
      .mockResolvedValueOnce({
        rows: [{ id: REQUEST_ID, status: "pending", vendorId: VENDOR_ID, neededBy: "2026-09-15" }],
      });

    const updated = await updateDirectoryPurchaseRequest({ query } as never, {
      orgId: ORG_ID,
      id: REQUEST_ID,
      body: validBody({ neededBy: "2026-09-15" }),
    });

    expect(updated.neededBy).toBe("2026-09-15");
    const updateCall = query.mock.calls[1];
    expect(updateCall?.[0]).toMatch(/needed_by=\$9/);
    expect(updateCall?.[1]?.[8]).toBe("2026-09-15");
  });

  it("refuses edit when the vendor id is not in the directory", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      updateDirectoryPurchaseRequest({ query } as never, {
        orgId: ORG_ID,
        id: REQUEST_ID,
        body: validBody(),
      }),
    ).rejects.toThrow(VENDOR_NOT_IN_DIRECTORY);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
