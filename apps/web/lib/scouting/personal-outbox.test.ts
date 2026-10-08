import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncEntry } from "@vantage/scouting";
import { ACTION_HISTORY_KEY, recordScoutAction } from "@vantage/scouting";
import { decodeScoutQrContent } from "@vantage/scouting/qr-handoff";
import { cacheEvent, clearCachedEvent, discardQuarantined, encodePendingQrPayload, getCachedEvent, getLastOrgId, listPendingEntries, listQuarantine, mergeRecordsIntoOutbox, pendingCounts, quarantineEntry, queueEntry, retryQuarantined, syncOutbox } from "../scout-offline";
import { idbValue, scoutTransaction } from "./personal-store";

const identity = vi.hoisted(() => ({ user: "a" as string | null }));
vi.mock("../offline/identity", () => ({ offlineSnapshotUser: async () => identity.user }));
const ORG = "team-one";
function entry(id = "shared-id", orgId = ORG): SyncEntry {
  return { clientId: id, orgId, schemaId: "schema", type: "match", eventKey: "2026test", matchKey: "2026test_qm1", teamKey: "frc1", confidence: "normal", source: "manual", updatedAt: "2026-09-26T12:00:00Z", payload: { score: 0 } };
}

describe("personal scouting on shared devices", () => {
  beforeEach(() => { identity.user = "a"; vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("navigator", { onLine: true }); });
  afterEach(() => vi.unstubAllGlobals());

  it.each([{ teamKey: "frc254" }, { matchKey: "2026test_qm2" }, { eventKey: "2026other" }, { type: "pit" as const }, { orgId: "team-two" }])(
    "refuses a client ID collision without replacing an unsent report: %j", async change => {
      const original = entry();
      await queueEntry(original);
      await expect(queueEntry({ ...original, ...change, payload: { score: 100 } })).rejects.toThrow("already belongs");
      expect(await listPendingEntries()).toEqual([original]);
    },
  );

  it("allows a newer correction for the same unsent robot report", async () => {
    await queueEntry(entry());
    const corrected = { ...entry(), payload: { score: 3 }, updatedAt: "2026-09-26T12:01:00Z" };
    await queueEntry(corrected);
    expect(await listPendingEntries()).toEqual([corrected]);
  });
  it("keeps a newer queued correction when another tab sends an older copy", async () => {
    const corrected = { ...entry(), payload: { score: 3 }, updatedAt: "2026-09-26T12:01:00Z" };
    await queueEntry(corrected);
    await expect(queueEntry(entry())).rejects.toThrow("newer correction");
    expect(await listPendingEntries()).toEqual([corrected]);
  });
  it("replaces a rejected entry only when the corrected answers commit", async () => {
    await queueEntry(entry());
    await quarantineEntry(entry(), "Required answer missing");
    await expect(queueEntry({ ...entry(), teamKey: "frc254" })).rejects.toThrow("already belongs");
    expect(await listQuarantine()).toHaveLength(1);
    const correction = { ...entry(), payload: { score: 3 }, updatedAt: "2026-09-26T12:01:00Z" };
    await queueEntry(correction);
    expect(await listQuarantine()).toEqual([]);
    expect(await listPendingEntries()).toEqual([correction]);
  });
  it("does not discard a rejected revision that changed after confirmation opened", async () => {
    await queueEntry(entry());
    await quarantineEntry(entry(), "Rejected");
    expect(await discardQuarantined("shared-id", "older-revision-time")).toBe(false);
    expect(await listQuarantine()).toHaveLength(1);
  });

  it("blocks new read caches at quota but preserves and accepts unsent reports", async () => {
    await cacheEvent(ORG, { saved: "event" });
    vi.stubGlobal("navigator", { onLine: true, storage: { estimate: async () => ({ usage: 1024, quota: 1024 }) } });
    await expect(cacheEvent(ORG, { replacement: true })).rejects.toThrow("cache limit");
    await queueEntry(entry("quota-report"));
    expect((await listPendingEntries()).map(row => row.clientId)).toEqual(["quota-report"]);
    expect(await getCachedEvent(ORG)).toEqual({ saved: "event" });
  });

  it("purges a denied team's cached event while retaining unsent reports and other teams", async () => {
    await cacheEvent(ORG, { private: "denied team" });
    await cacheEvent("other-team", { private: "still allowed" });
    await queueEntry(entry("not-uploaded"));
    await clearCachedEvent(ORG);
    expect(await getCachedEvent(ORG)).toBeNull();
    expect(await getCachedEvent("other-team")).toEqual({ private: "still allowed" });
    expect((await listPendingEntries())[0]?.clientId).toBe("not-uploaded");
  });

  it("keeps two people's identical client IDs, cache, counts and last team separate", async () => {
    await queueEntry(entry());
    await cacheEvent(ORG, { myEntries: ["a-private"] });
    identity.user = "b";
    expect(await listPendingEntries()).toEqual([]);
    expect(await getCachedEvent(ORG)).toBeNull();
    expect(await getLastOrgId()).toBeNull();
    expect(await pendingCounts()).toEqual({ entries: 0, media: 0, quarantined: 0 });
    await queueEntry({ ...entry(), payload: { score: 3 } });
    identity.user = "a";
    expect((await listPendingEntries())[0].payload.score).toBe(0);
    expect(await getCachedEvent(ORG)).toEqual({ myEntries: ["a-private"] });
    expect(await getLastOrgId()).toBe(ORG);
  });

  it("rejects anonymous saves and does not read or adopt the legacy database", async () => {
    const open = indexedDB.open("vantage-scouting", 3);
    open.onupgradeneeded = () => open.result.createObjectStore("entry-outbox", { keyPath: "clientId" });
    const legacy = await idbValue(open);
    const tx = legacy.transaction("entry-outbox", "readwrite");
    await idbValue(tx.objectStore("entry-outbox").put(entry("legacy")));
    expect(await listPendingEntries()).toEqual([]);
    const read = legacy.transaction("entry-outbox", "readonly");
    expect(await idbValue(read.objectStore("entry-outbox").count())).toBe(1);
    legacy.close();
    identity.user = null;
    expect(await listPendingEntries()).toEqual([]);
    await expect(queueEntry(entry())).rejects.toThrow("Sign in");
  });

  it("exports only this scout's selected team and preserves history through QR import", async () => {
    const payload = recordScoutAction({}, { score: 0 }, { id: "event-1", at: "2026-09-26T12:00:00Z" });
    await queueEntry({ ...entry(), payload });
    await queueEntry(entry("other-team", "team-two"));
    const qr = await encodePendingQrPayload({ orgId: ORG });
    const decoded = decodeScoutQrContent(qr);
    if (decoded.kind === "handoff") throw new Error("Expected embedded code");
    expect(decoded.records).toHaveLength(1);
    expect(decoded.records[0].payload[ACTION_HISTORY_KEY]).toEqual(payload[ACTION_HISTORY_KEY]);
    identity.user = "b";
    await mergeRecordsIntoOutbox({ records: decoded.records, orgId: ORG, schemaId: "schema", type: "match" });
    expect((await listPendingEntries())[0].payload[ACTION_HISTORY_KEY]).toEqual(payload[ACTION_HISTORY_KEY]);
    identity.user = "a";
    expect(await listPendingEntries()).toHaveLength(2);
  });

  it("does not clear a second team's queue during a QR merge", async () => {
    await queueEntry(entry("other-team", "team-two"));
    const incoming = entry("incoming");
    await mergeRecordsIntoOutbox({ records: [incoming], orgId: ORG, schemaId: "schema", type: "match" });
    expect((await listPendingEntries()).map(row => row.clientId).sort()).toEqual(["incoming", "other-team"]);
  });

  it("isolates quarantine retry and discard, including same-client-ID collisions", async () => {
    await queueEntry(entry());
    expect(await quarantineEntry(entry(), "Required answer missing")).toBe(true);
    identity.user = "b";
    expect(await listQuarantine()).toEqual([]);
    expect(await retryQuarantined("shared-id")).toBe(false);
    await discardQuarantined("shared-id");
    identity.user = "a";
    expect(await listQuarantine()).toHaveLength(1);
    expect(await retryQuarantined("shared-id")).toBe(true);
    expect(await listPendingEntries()).toHaveLength(1);
  });

  it("preserves a corrected copy when an older save is rejected", async () => {
    await queueEntry({ ...entry(), payload: { score: 5 }, updatedAt: "2026-09-26T12:01:00Z" });
    expect(await quarantineEntry(entry(), "Older rejection")).toBe(false);
    expect(await listQuarantine()).toEqual([]);
    expect((await listPendingEntries())[0].payload.score).toBe(5);
  });

  it("sends only the current person's current team, then removes acknowledged rows", async () => {
    await queueEntry(entry());
    await queueEntry(entry("other-team", "team-two"));
    identity.user = "b";
    const send = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({ acknowledgements: body.entries.map((e: SyncEntry) => ({ clientId: e.clientId })) }) };
    });
    vi.stubGlobal("fetch", send);
    expect((await syncOutbox(ORG, { maxAttempts: 1 })).count).toBe(0);
    expect(send).not.toHaveBeenCalled();
    identity.user = "a";
    expect((await syncOutbox(ORG, { maxAttempts: 1 })).count).toBe(1);
    expect(JSON.parse(String(send.mock.calls[0][1].body)).entries.map((row: SyncEntry) => row.clientId)).toEqual(["shared-id"]);
    expect((await listPendingEntries()).map(row => row.clientId)).toEqual(["other-team"]);
  });

  it("preserves queued data when identity switches during an upload", async () => {
    await queueEntry(entry());
    vi.stubGlobal("fetch", vi.fn(async () => {
      identity.user = "b";
      return { ok: true, json: async () => ({ acknowledgements: [{ clientId: "shared-id" }] }) };
    }));
    await expect(syncOutbox(ORG, { maxAttempts: 1 })).rejects.toThrow("account changed");
    identity.user = "a";
    expect(await listPendingEntries()).toHaveLength(1);
  });

  it("ties official checks to the acknowledged observation's identity", async () => {
    const report = entry();
    await queueEntry(report);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ acknowledgements: [{ clientId: report.clientId,
      validations: [{ fieldKey: "score", status: "conflict", scoutValue: 0, officialValue: 3, officialSource: "breakdown", detail: "Scores differ." }] }] }) })));
    expect((await syncOutbox(ORG, { maxAttempts: 1 })).validations).toEqual([expect.objectContaining({
      clientId: report.clientId, orgId: ORG, eventKey: report.eventKey, matchKey: report.matchKey,
      teamKey: report.teamKey, schemaId: report.schemaId, type: report.type,
    })]);
  });

  it("rolls back interrupted transactions instead of claiming an offline save", async () => {
    await expect(scoutTransaction("a", "entry-outbox", "readwrite", async tx => {
      tx.objectStore("entry-outbox").put(entry());
      tx.abort();
    })).rejects.toThrow();
    expect(await listPendingEntries()).toEqual([]);
  });
});
