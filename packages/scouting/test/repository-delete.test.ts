import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { ScoutingRepository } from "../src/repository";

function recordingClient(role: string, deletedClientId: string | null, closedIds: string[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM memberships")) return { rows: [{ role }], rowCount: 1 };
      if (sql.includes("DELETE FROM match_scout_entries") || sql.includes("DELETE FROM pit_scout_entries")) {
        return deletedClientId
          ? { rows: [{ clientId: deletedClientId }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("UPDATE scout_disagreements")) {
        return { rows: closedIds.map((id) => ({ id, entryIds: ["e1", "e2"] })), rowCount: closedIds.length };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { client: client as unknown as PoolClient, calls };
}

describe("deleting a scout report", () => {
  it("removes the report, its sync receipt, and closes disagreements that named it", async () => {
    const { client, calls } = recordingClient("owner", "phone-abc", ["d1"]);
    const deleted = await new ScoutingRepository(client).deleteEntry("org-1", "lead-1", { entryId: "e1", type: "match" });
    expect(deleted).toBe(true);
    const receipt = calls.find((call) => call.sql.includes("DELETE FROM scout_sync_receipts"));
    expect(receipt?.params).toEqual(["org-1", "phone-abc", "match"]);
    const closed = calls.find((call) => call.sql.includes("UPDATE scout_disagreements"));
    expect(closed?.sql).toContain("status = 'dismissed'");
    expect(closed?.params).toEqual(["org-1", "e1", "lead-1"]);
    expect(calls.some((call) => call.sql.includes("INSERT INTO scout_disagreement_audit"))).toBe(true);
  });

  it("does nothing else when the report was already gone", async () => {
    const { client, calls } = recordingClient("admin", null);
    const deleted = await new ScoutingRepository(client).deleteEntry("org-1", "lead-1", { entryId: "e9", type: "pit" });
    expect(deleted).toBe(false);
    expect(calls.some((call) => call.sql.includes("scout_sync_receipts"))).toBe(false);
  });

  it("refuses a scout", async () => {
    const { client } = recordingClient("scout", "phone-abc");
    await expect(
      new ScoutingRepository(client).deleteEntry("org-1", "s1", { entryId: "e1", type: "match" }),
    ).rejects.toThrow(/Coach role/);
  });
});
