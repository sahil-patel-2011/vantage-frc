import { describe, expect, it } from "vitest";
import type { SyncEntry } from "@vantage/scouting";
import {
  envelopeBelongsToSession,
  isP2pEnvelope,
  mergeP2pRecords,
  parseP2pEnvelope,
  p2pChannelName,
  p2pMergeLedgerCounts,
} from "./pit-mesh";

function entry(over: Partial<SyncEntry> & { clientId: string }): SyncEntry {
  return {
    type: "match",
    eventKey: "2026test",
    teamKey: "frc254",
    schemaId: "schema-1",
    payload: { cycles: 1 },
    confidence: "normal",
    source: "manual",
    updatedAt: "2026-03-01T12:00:00.000Z",
    ...over,
  };
}

describe("pit mesh envelopes", () => {
  it("names a stable BroadcastChannel per org and session", () => {
    expect(p2pChannelName("org-1", "sess-1")).toBe("vantage-scout-p2p:org-1:sess-1");
  });

  it("accepts a version-1 envelope and rejects garbage", () => {
    const envelope = {
      v: 1 as const,
      orgId: "org-1",
      sessionId: "sess-1",
      deviceId: "dev-1",
      deviceLabel: "Tablet A",
      deviceRole: "scout" as const,
      records: [],
      sentAt: "2026-03-01T12:00:00.000Z",
    };
    expect(isP2pEnvelope(envelope)).toBe(true);
    expect(envelopeBelongsToSession(envelope, { orgId: "org-1", sessionId: "sess-1" })).toBe(true);
    expect(envelopeBelongsToSession(envelope, { orgId: "org-2", sessionId: "sess-1" })).toBe(false);
    expect(parseP2pEnvelope("not-json")).toBeNull();
    expect(parseP2pEnvelope(JSON.stringify({ v: 2 }))).toBeNull();
    expect(JSON.stringify(envelope)).not.toMatch(/DEMO/i);
  });

  it("merges peer records last-write-wins and counts replacements as conflicts", () => {
    const existing = [entry({ clientId: "a", updatedAt: "2026-03-01T12:00:00.000Z", payload: { cycles: 1 } })];
    const merged = mergeP2pRecords(existing, [
      {
        clientId: "a",
        eventKey: "2026test",
        teamKey: "frc254",
        payload: { cycles: 4 },
        updatedAt: "2026-03-01T12:05:00.000Z",
      },
      {
        clientId: "b",
        eventKey: "2026test",
        teamKey: "frc118",
        payload: { cycles: 2 },
        updatedAt: "2026-03-01T12:06:00.000Z",
      },
    ]);
    expect(merged.accepted).toBe(1);
    expect(merged.replaced).toBe(1);
    expect(merged.queued).toHaveLength(2);
    expect(merged.queued.find((row) => row.clientId === "a")?.payload.cycles).toBe(4);
    expect(p2pMergeLedgerCounts(merged)).toEqual({ entriesContributed: 2, conflictsResolved: 1 });
  });

  it("treats an empty heartbeat as a no-op merge", () => {
    const existing = [entry({ clientId: "a" })];
    const merged = mergeP2pRecords(existing, []);
    expect(merged.accepted).toBe(0);
    expect(merged.queued).toHaveLength(1);
  });
});
