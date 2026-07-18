import { describe, expect, it } from "vitest";
import {
  applyPendingToCoverage,
  decodeScoutQrContent,
  encodeScoutQrPayload,
  importedToSyncEntries,
  mergeOfflineHandoff,
  summarizeCoverage,
  syncEntriesToQrRecords,
} from "../src/qr-handoff";
import type { SyncEntry } from "../src";

function entry(partial: Partial<SyncEntry> & Pick<SyncEntry, "clientId" | "teamKey">): SyncEntry {
  return {
    type: "match",
    eventKey: "2026test",
    matchKey: "2026test_qm1",
    schemaId: "schema-1",
    payload: { auto: 2 },
    confidence: "normal",
    source: "manual",
    updatedAt: "2026-07-17T12:00:00.000Z",
    ...partial,
  };
}

describe("QR scout handoff integration", () => {
  it("round-trips SyncEntries through embedded QR into import-sourced outbox rows", () => {
    const encoded = encodeScoutQrPayload(
      syncEntriesToQrRecords([
        entry({ clientId: "c1", teamKey: "frc254", payload: { auto: 3, climb: "high" } }),
      ]),
    );
    expect(encoded.startsWith("vantage://scout/")).toBe(true);
    const decoded = decodeScoutQrContent(encoded);
    expect(decoded.kind).toBe("embedded");
    if (decoded.kind === "handoff") throw new Error("expected embedded");
    const sync = importedToSyncEntries({
      records: decoded.records,
      schemaId: "fallback",
      type: "pit",
    });
    expect(sync[0]).toMatchObject({
      clientId: "c1",
      type: "match",
      schemaId: "schema-1",
      source: "import",
      payload: { auto: 3, climb: "high" },
    });
  });

  it("merges offline with last-write-wins", () => {
    const merged = mergeOfflineHandoff(
      [entry({ clientId: "c1", teamKey: "frc111", payload: { auto: 1 }, updatedAt: "2026-07-17T12:00:00.000Z" })],
      [
        entry({
          clientId: "c1",
          teamKey: "frc111",
          payload: { auto: 5 },
          updatedAt: "2026-07-17T14:00:00.000Z",
          source: "import",
        }),
        entry({ clientId: "c3", teamKey: "frc333", payload: { auto: 2 }, source: "import" }),
      ],
    );
    expect(merged.accepted).toBe(1);
    expect(merged.replaced).toBe(1);
    expect(merged.queued.find((row) => row.clientId === "c1")?.payload.auto).toBe(5);
  });

  it("overlays pending QR/outbox rows onto coverage cells", () => {
    const cells = applyPendingToCoverage(
      [
        { matchKey: "qm1", teamKey: "frc1", assignmentCount: 1, entryCount: 0 },
        { matchKey: "qm1", teamKey: "frc2", assignmentCount: 0, entryCount: 1 },
      ],
      [
        entry({ clientId: "p1", matchKey: "qm1", teamKey: "frc1" }),
        entry({ clientId: "p2", matchKey: "qm1", teamKey: "frc1" }),
      ],
    );
    expect(cells[0]?.state).toBe("double_covered");
    expect(summarizeCoverage(cells).pendingRows).toBe(1);
  });
});
