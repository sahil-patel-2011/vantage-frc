import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { upsertGearbox, type GearboxSaveInput } from "./service";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const save: GearboxSaveInput = {
  orgId: ORG,
  seasonYear: 2026,
  name: "SDS MK4i L2",
  subsystem: "Drivetrain",
  stages: [{ driving: 14, driven: 50 }],
  motorFreeRpm: 6000,
  notes: "swerve",
  createdBy: USER,
};

type Call = { sql: string; params: unknown[] };

function stubClient(options: {
  byId?: { id: string } | null;
  byIdentity?: { id: string } | null;
  updateId?: string;
  insertError?: { code: string; constraint: string };
  identityAfterInsert?: { id: string } | null;
}) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("WHERE id = $1::uuid AND org_id = $2::uuid") && sql.includes("SELECT")) {
      return options.byId ? { rows: [{ ...save, id: options.byId.id, orgId: ORG, seasonYear: 2026 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes("lower(name)") && sql.includes("SELECT")) {
      const identity =
        calls.filter((call) => call.sql.includes("lower(name)") && call.sql.includes("SELECT")).length > 1
          ? (options.identityAfterInsert ?? options.byIdentity)
          : options.byIdentity;
      return identity
        ? { rows: [{ ...save, id: identity.id, orgId: ORG, seasonYear: 2026 }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.trimStart().startsWith("UPDATE gearboxes")) {
      return { rows: [{ id: options.updateId ?? options.byIdentity?.id ?? options.byId?.id }], rowCount: 1 };
    }
    if (sql.trimStart().startsWith("INSERT INTO gearboxes")) {
      if (options.insertError) throw options.insertError;
      return { rows: [{ id: "new-gb" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as unknown as PoolClient, query, calls };
}

const writes = (calls: Call[]) => calls.filter((call) => /^(INSERT|UPDATE)/.test(call.sql.trimStart()));

describe("upsertGearbox", () => {
  it("inserts when no saved gearbox matches", async () => {
    const { client, calls } = stubClient({});
    const result = await upsertGearbox(client, save);
    expect(result).toEqual({ id: "new-gb", wrote: "insert" });
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.sql).toMatch(/^INSERT INTO gearboxes/);
    expect(writes(calls)[0]!.sql).not.toMatch(/UPDATE/);
  });

  it("updates the existing row instead of inserting a second copy of the same name", async () => {
    const { client, calls } = stubClient({ byIdentity: { id: "gb-1" }, updateId: "gb-1" });
    const result = await upsertGearbox(client, save);
    expect(result).toEqual({ id: "gb-1", wrote: "update" });
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.sql).toMatch(/^UPDATE gearboxes/);
    expect(calls.some((call) => call.sql.includes("INSERT INTO gearboxes"))).toBe(false);
  });

  it("updates by id so a rename does not create a second row", async () => {
    const { client, calls } = stubClient({ byId: { id: "gb-1" }, updateId: "gb-1" });
    const result = await upsertGearbox(client, { ...save, id: "gb-1", name: "SDS MK4i L3" });
    expect(result).toEqual({ id: "gb-1", wrote: "update" });
    expect(writes(calls)[0]!.sql).toMatch(/^UPDATE gearboxes/);
    expect(writes(calls)[0]!.params[0]).toBe("SDS MK4i L3");
    expect(writes(calls)[0]!.params[5]).toBe("gb-1");
    expect(calls.some((call) => call.sql.includes("INSERT INTO gearboxes"))).toBe(false);
  });

  it("treats a concurrent identity unique violation as an update", async () => {
    const { client, calls } = stubClient({
      insertError: { code: "23505", constraint: "gearboxes_identity_uidx" },
      identityAfterInsert: { id: "gb-race" },
      updateId: "gb-race",
    });
    const result = await upsertGearbox(client, save);
    expect(result).toEqual({ id: "gb-race", wrote: "update" });
    expect(writes(calls).some((call) => call.sql.startsWith("UPDATE gearboxes"))).toBe(true);
  });
});
