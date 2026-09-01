import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  parseWeightWrite,
  plannedLineIdentityKey,
  plannedLineSaveFromWrite,
  resolvePlannedLineWrite,
  upsertPlannedLine,
  type ExistingPlannedLineRef,
  type PlannedLineSaveInput,
} from "./upsert";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const incoming = {
  orgId: ORG,
  seasonYear: 2026,
  name: "Swerve module",
  subsystem: "Drivetrain",
};

const save: PlannedLineSaveInput = {
  ...incoming,
  weightLbs: 8.5,
  quantity: 4,
  notes: "SDS MK4i",
  createdBy: USER,
};

function existing(over: Partial<ExistingPlannedLineRef> = {}): ExistingPlannedLineRef {
  return { id: "wc-1", ...incoming, ...over };
}

type Call = { sql: string; params: unknown[] };

function stubClient(options: { byId?: { id: string } | null; byIdentity?: { id: string } | null; updateId?: string }) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("WHERE id = $1::uuid AND org_id = $2::uuid") && sql.includes("SELECT")) {
      return options.byId
        ? { rows: [{ ...incoming, id: options.byId.id, orgId: ORG, seasonYear: 2026 }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes("lower(name)") && sql.includes("SELECT")) {
      return options.byIdentity
        ? { rows: [{ ...incoming, id: options.byIdentity.id, orgId: ORG, seasonYear: 2026 }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.trimStart().startsWith("UPDATE weight_components")) {
      return { rows: [{ id: options.updateId ?? options.byIdentity?.id ?? options.byId?.id }], rowCount: 1 };
    }
    if (sql.trimStart().startsWith("INSERT INTO weight_components")) {
      return { rows: [{ id: "new-wc" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as unknown as PoolClient, query, calls };
}

const writes = (calls: Call[]) => calls.filter((call) => /^(INSERT|UPDATE)/.test(call.sql.trimStart()));

describe("plannedLineIdentityKey", () => {
  it("treats name and subsystem as case-insensitive", () => {
    expect(plannedLineIdentityKey(incoming)).toBe(
      plannedLineIdentityKey({ ...incoming, name: "swerve module", subsystem: "drivetrain" }),
    );
  });

  it("keeps a different season or subsystem as a different planned line", () => {
    expect(plannedLineIdentityKey({ ...incoming, seasonYear: 2025 })).not.toBe(plannedLineIdentityKey(incoming));
    expect(plannedLineIdentityKey({ ...incoming, subsystem: "Elevator" })).not.toBe(plannedLineIdentityKey(incoming));
  });
});

describe("resolvePlannedLineWrite — insert vs upsert", () => {
  it("inserts when nothing matches", () => {
    expect(resolvePlannedLineWrite(incoming, [])).toEqual({ kind: "insert" });
  });

  it("updates in place when the same org, season, name, and subsystem already exist", () => {
    expect(resolvePlannedLineWrite(incoming, [existing()])).toEqual({
      kind: "update",
      id: "wc-1",
      reason: "identity",
    });
  });

  it("does not insert a duplicate when the saved spelling differs only by case", () => {
    expect(resolvePlannedLineWrite({ ...incoming, name: "swerve module" }, [existing()])).toMatchObject({
      kind: "update",
      id: "wc-1",
    });
  });

  it("inserts when the name is new even if the subsystem matches", () => {
    expect(resolvePlannedLineWrite({ ...incoming, name: "Battery mount" }, [existing()])).toEqual({ kind: "insert" });
  });

  it("inserts the same name in a different season instead of overwriting last year", () => {
    expect(resolvePlannedLineWrite({ ...incoming, seasonYear: 2027 }, [existing()])).toEqual({ kind: "insert" });
  });

  it("inserts when the matching name lives in another org", () => {
    expect(resolvePlannedLineWrite(incoming, [existing({ orgId: OTHER })])).toEqual({ kind: "insert" });
  });

  it("prefers an explicit id so a rename updates the same row", () => {
    expect(
      resolvePlannedLineWrite({ ...incoming, name: "MK4i module", id: "wc-1" }, [existing()]),
    ).toEqual({ kind: "update", id: "wc-1", reason: "id" });
  });

  it("does not update another org's row even when the client sends that id", () => {
    expect(resolvePlannedLineWrite({ ...incoming, id: "wc-1" }, [existing({ orgId: OTHER })])).toEqual({
      kind: "insert",
    });
  });

  it("falls back to the natural key when the sent id is gone", () => {
    expect(resolvePlannedLineWrite({ ...incoming, id: "missing" }, [existing({ id: "wc-2" })])).toEqual({
      kind: "update",
      id: "wc-2",
      reason: "identity",
    });
  });
});

describe("parseWeightWrite", () => {
  const body = {
    action: "upsert_component",
    orgId: ORG,
    seasonYear: 2026,
    name: "Swerve module",
    subsystem: "Drivetrain",
    weightLbs: 8.5,
    quantity: 4,
  };

  it("parses upsert_component as a planned-line write", () => {
    expect(parseWeightWrite(body)).toMatchObject({
      action: "upsert_component",
      name: "Swerve module",
      weightLbs: 8.5,
      quantity: 4,
    });
  });

  it("carries an explicit id so the API can update that row", () => {
    expect(parseWeightWrite({ ...body, id: "wc-1" })).toMatchObject({ action: "upsert_component", id: "wc-1" });
  });

  it("keeps create_component without an id as an insert-shaped action", () => {
    const parsed = parseWeightWrite({ ...body, action: "create_component" });
    expect(parsed).toMatchObject({ action: "create_component", name: "Swerve module" });
    expect("id" in parsed && parsed.action === "create_component" ? parsed.id : undefined).toBeUndefined();
  });

  it("does not invent a DEMO / default planned lb when weight is missing", () => {
    expect(() =>
      parseWeightWrite({ action: "upsert_component", orgId: ORG, seasonYear: 2026, name: "Drive" }),
    ).toThrow(/Weight must be zero or greater/);
  });

  it("still parses set_limit and delete_component", () => {
    expect(parseWeightWrite({ action: "set_limit", orgId: ORG, seasonYear: 2026, limitLbs: 115 })).toMatchObject({
      action: "set_limit",
      limitLbs: 115,
    });
    expect(parseWeightWrite({ action: "delete_component", orgId: ORG, id: "wc-1" })).toMatchObject({
      action: "delete_component",
      id: "wc-1",
    });
  });
});

describe("plannedLineSaveFromWrite", () => {
  it("does not fill a DEMO 115 / 125 lb when mapping an update patch", () => {
    const saveFromUpdate = plannedLineSaveFromWrite(
      {
        action: "update_component",
        orgId: ORG,
        id: "wc-1",
        patch: { name: "Swerve module", subsystem: "Drivetrain", weightLbs: 8.5, quantity: 4, notes: "" },
      },
      USER,
    );
    expect(saveFromUpdate.weightLbs).toBe(8.5);
    expect(saveFromUpdate.weightLbs).not.toBe(115);
    expect(saveFromUpdate.weightLbs).not.toBe(125);
  });
});

describe("upsertPlannedLine", () => {
  it("inserts when no planned line matches", async () => {
    const { client, calls } = stubClient({});
    const result = await upsertPlannedLine(client, save);
    expect(result).toEqual({ id: "new-wc", wrote: "insert" });
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.sql).toMatch(/^INSERT INTO weight_components/);
    expect(writes(calls)[0]!.sql).not.toMatch(/robot_weights/);
    expect(writes(calls)[0]!.params).toEqual([ORG, 2026, "Swerve module", "Drivetrain", 8.5, 4, "SDS MK4i", USER]);
  });

  it("updates the existing row instead of inserting a second copy of the same name", async () => {
    const { client, calls } = stubClient({ byIdentity: { id: "wc-1" }, updateId: "wc-1" });
    const result = await upsertPlannedLine(client, save);
    expect(result).toEqual({ id: "wc-1", wrote: "update" });
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.sql).toMatch(/^UPDATE weight_components/);
    expect(calls.some((call) => call.sql.includes("INSERT INTO weight_components"))).toBe(false);
    expect(calls.every((call) => !call.sql.includes("robot_weights"))).toBe(true);
  });

  it("updates by id so a rename does not create a second row", async () => {
    const { client, calls } = stubClient({ byId: { id: "wc-1" }, updateId: "wc-1" });
    const result = await upsertPlannedLine(client, { ...save, id: "wc-1", name: "MK4i module" });
    expect(result).toEqual({ id: "wc-1", wrote: "update" });
    expect(writes(calls)[0]!.sql).toMatch(/^UPDATE weight_components/);
    expect(writes(calls)[0]!.params[0]).toBe("MK4i module");
    expect(writes(calls)[0]!.params[5]).toBe("wc-1");
    expect(calls.some((call) => call.sql.includes("INSERT INTO weight_components"))).toBe(false);
  });

  it("does not invent a DEMO planned lb on insert", async () => {
    const { client, calls } = stubClient({});
    await upsertPlannedLine(client, save);
    const insertedLbs = writes(calls)[0]!.params[4];
    expect(insertedLbs).toBe(8.5);
    expect(insertedLbs).not.toBe(115);
    expect(insertedLbs).not.toBe(125);
    expect(insertedLbs).not.toBe(0);
  });

  it("refuses to insert when an update-shaped write has no season and no matching id", async () => {
    const { client, calls } = stubClient({});
    await expect(upsertPlannedLine(client, { ...save, id: "missing", seasonYear: 0 })).rejects.toThrow(
      /Component not found/,
    );
    expect(writes(calls)).toHaveLength(0);
  });
});
