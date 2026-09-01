import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeFmeaView, createFailure, updateFailure } from "./compute-fmea";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const FAILURE_ID = "55555555-5555-4555-8555-555555555555";

function makeClient(
  handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number },
): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

const baseCreate = {
  orgId: ORG,
  userId: USER,
  seasonYear: 2026,
  title: "Intake belt jumped",
  failureMode: "Teeth skip",
  context: "pit" as const,
  subsystemId: null,
  subsystemName: "Intake",
  occurrence: 4,
  severity: 6,
  detection: 3,
  rootCause: null,
  fiveWhys: null,
  fix: null,
  status: "open" as const,
  inspectionItemId: null,
  eventKey: null,
  matchKey: null,
  robotLabel: "competition",
  occurredAt: null,
};

describe("createFailure inventory hop", () => {
  it("writes inventory_item_id when the spare bin belongs to the org", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM inventory_items")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes("INSERT INTO fmea_failures")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await createFailure(client, { ...baseCreate, inventoryItemId: ITEM_ID });

    const insert = calls.find((c) => c.sql.includes("INSERT INTO fmea_failures"));
    expect(insert?.sql).toMatch(/inventory_item_id/);
    expect(insert?.params).toContain(ITEM_ID);
  });

  it("rejects an inventory item that is not in the org — does not invent a catalog link", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM inventory_items")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    await expect(createFailure(client, { ...baseCreate, inventoryItemId: ITEM_ID })).rejects.toThrow(
      /Inventory item not found/,
    );
  });

  it("retries the insert without inventory_item_id when the column is unmigrated", async () => {
    let inserts = 0;
    const client = makeClient((sql) => {
      if (sql.includes("FROM inventory_items") && !sql.includes("INSERT")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO fmea_failures")) {
        inserts += 1;
        if (sql.includes("inventory_item_id")) {
          throw Object.assign(new Error('column "inventory_item_id" does not exist'), { code: "42703" });
        }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await createFailure(client, { ...baseCreate, inventoryItemId: ITEM_ID });
    expect(inserts).toBe(2);
  });
});

describe("updateFailure inventory hop", () => {
  it("patches inventory_item_id when the spare bin belongs to the org", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM inventory_items")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes("UPDATE fmea_failures")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await updateFailure(client, { orgId: ORG, failureId: FAILURE_ID, inventoryItemId: ITEM_ID });

    const update = calls.find((c) => c.sql.includes("UPDATE fmea_failures"));
    expect(update?.sql).toMatch(/inventory_item_id/);
    expect(update?.params).toContain(ITEM_ID);
  });
});

describe("computeFmeaView inventory hop", () => {
  it("maps inventory_item_id from the failure row and lists org spare bins", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM fmea_failures") && sql.includes("SELECT f.id")) {
        return {
          rows: [
            {
              id: FAILURE_ID,
              title: "Intake belt jumped",
              failureMode: "Teeth skip",
              context: "pit",
              subsystemId: null,
              subsystemName: "Intake",
              occurrence: 4,
              severity: 6,
              detection: 3,
              rootCause: null,
              fiveWhys: null,
              fix: null,
              status: "open",
              inspectionItemId: null,
              inventoryItemId: ITEM_ID,
              inventoryItemName: "Falcon 500 spare",
              eventKey: null,
              matchKey: null,
              robotLabel: "competition",
              occurredAt: "2026-03-15T12:00:00.000Z",
              seasonYear: 2026,
              recordedByName: "Mentor",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM inventory_items") && sql.includes("archived")) {
        return {
          rows: [{ id: ITEM_ID, name: "Falcon 500 spare", category: "spare", subsystem: "Drivetrain" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeFmeaView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live");
    expect(view.evaluations[0]?.failure.inventoryItemId).toBe(ITEM_ID);
    expect(view.evaluations[0]?.failure.inventoryItemName).toBe("Falcon 500 spare");
    expect(view.inventoryItems).toEqual([
      { id: ITEM_ID, name: "Falcon 500 spare", category: "spare", subsystem: "Drivetrain" },
    ]);
  });

  it("retries the failure select without inventory_item_id when the column is unmigrated", async () => {
    let failureSelects = 0;
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM fmea_failures") && sql.includes("SELECT f.id")) {
        failureSelects += 1;
        if (sql.includes("inventory_item_id")) {
          throw Object.assign(new Error('column "inventory_item_id" does not exist'), { code: "42703" });
        }
        return {
          rows: [
            {
              id: FAILURE_ID,
              title: "Intake belt jumped",
              failureMode: "Teeth skip",
              context: "pit",
              subsystemId: null,
              subsystemName: "Intake",
              occurrence: 4,
              severity: 6,
              detection: 3,
              rootCause: null,
              fiveWhys: null,
              fix: null,
              status: "open",
              inspectionItemId: null,
              inventoryItemId: null,
              inventoryItemName: null,
              eventKey: null,
              matchKey: null,
              robotLabel: "competition",
              occurredAt: "2026-03-15T12:00:00.000Z",
              seasonYear: 2026,
              recordedByName: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeFmeaView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live");
    expect(failureSelects).toBe(2);
    expect(view.evaluations[0]?.failure.inventoryItemId).toBeNull();
  });
});
