import { createHash } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { ScoutingRepository } from "../src/repository";
import type { ScoutSchema, SyncEntry } from "../src";

const schema: ScoutSchema = {
  id: "schema-1",
  orgId: "org-1",
  year: 2026,
  type: "match",
  version: 1,
  definition: {
    title: "Match",
    fields: [
      { key: "auto", label: "Auto", type: "number", required: true },
      { key: "climb", label: "Climb", type: "select", options: ["none", "low", "high"] },
    ],
  },
};

function makeClient(state: {
  receipts: Map<string, { serverEntryId: string; payloadHash: string }>;
  inserts: unknown[][];
  updates: unknown[][];
}) {
  return {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("FROM scout_schemas")) {
        return { rows: [schema], rowCount: 1 };
      }
      if (sql.includes("FROM scout_sync_receipts")) {
        const clientId = String(params[1]);
        const existing = state.receipts.get(clientId);
        return {
          rows: existing
            ? [{ serverEntryId: existing.serverEntryId, payloadHash: existing.payloadHash }]
            : [],
          rowCount: existing ? 1 : 0,
        };
      }
      if (sql.includes("INSERT INTO match_scout_entries")) {
        state.inserts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO scout_sync_receipts")) {
        state.receipts.set(String(params[1]), {
          serverEntryId: String(params[3]),
          payloadHash: String(params[4]),
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE match_scout_entries")) {
        state.updates.push(params);
        return { rows: [{ id: params[5] }], rowCount: 1 };
      }
      if (sql.includes("UPDATE scout_sync_receipts")) {
        const clientId = String(params[2]);
        const current = state.receipts.get(clientId);
        if (current) state.receipts.set(clientId, { ...current, payloadHash: String(params[0]) });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM match_scout_entries") && sql.includes("SELECT id, payload")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO scout_disagreements")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
}

describe("scouting sync upsert", () => {
  const entry: SyncEntry = {
    clientId: "client-entry-1",
    type: "match",
    eventKey: "2026test",
    matchKey: "2026test_qm1",
    teamKey: "frc254",
    schemaId: "schema-1",
    payload: { auto: 3, climb: "high" },
    confidence: "normal",
    source: "manual",
    updatedAt: "2026-07-15T12:00:00.000Z",
  };

  it("inserts a new entry and returns a receipt", async () => {
    const state = {
      receipts: new Map<string, { serverEntryId: string; payloadHash: string }>(),
      inserts: [] as unknown[][],
      updates: [] as unknown[][],
    };
    const repository = new ScoutingRepository(makeClient(state));
    const result = await repository.syncEntry("org-1", "user-1", entry);
    expect(result.duplicate).toBe(false);
    expect(result.entryId).toBeTruthy();
    expect(state.inserts).toHaveLength(1);
    expect(state.receipts.get(entry.clientId)?.payloadHash).toBe(
      createHash("sha256").update(JSON.stringify(entry)).digest("hex"),
    );
  });

  it("returns duplicate:true for an identical replay", async () => {
    const state = {
      receipts: new Map<string, { serverEntryId: string; payloadHash: string }>(),
      inserts: [] as unknown[][],
      updates: [] as unknown[][],
    };
    const repository = new ScoutingRepository(makeClient(state));
    const first = await repository.syncEntry("org-1", "user-1", entry);
    const second = await repository.syncEntry("org-1", "user-1", entry);
    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ duplicate: true, entryId: first.entryId });
    expect(state.inserts).toHaveLength(1);
  });

  it("updates payload when the same clientId syncs a newer body", async () => {
    const state = {
      receipts: new Map<string, { serverEntryId: string; payloadHash: string }>(),
      inserts: [] as unknown[][],
      updates: [] as unknown[][],
    };
    const repository = new ScoutingRepository(makeClient(state));
    const first = await repository.syncEntry("org-1", "user-1", entry);
    const changed: SyncEntry = {
      ...entry,
      payload: { auto: 4, climb: "low" },
      updatedAt: "2026-07-15T13:00:00.000Z",
    };
    const second = await repository.syncEntry("org-1", "user-1", changed);
    expect(second.duplicate).toBe(false);
    expect(second.entryId).toBe(first.entryId);
    expect(state.updates).toHaveLength(1);
  });
});
