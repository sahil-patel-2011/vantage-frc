import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { attachDeskEvidence, removeDeskEvidence } from "./compute-alliance-selection-desk";
const input = { orgId: "org", userId: "lead", sessionId: "session", slotId: "slot", sourceKind: "note" as const, note: "Reliable defense" };

describe("alliance desk evidence integrity", () => {
  it("refuses a slot outside the selected session before inserting evidence", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [], rowCount: 0 }));
    await expect(attachDeskEvidence({ query } as unknown as PoolClient, input)).rejects.toThrow(/Slot not found/);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("slot.id=$3::uuid");
  });
  it("keeps a locked board's evidence frozen for attachment and removal", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [{ status: "locked" }], rowCount: 1 }));
    const db = { query } as unknown as PoolClient;
    await expect(attachDeskEvidence(db, input)).rejects.toThrow(/Session is locked/);
    await expect(removeDeskEvidence(db, { orgId: "org", evidenceId: "evidence" })).rejects.toThrow(/Session is locked/);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
