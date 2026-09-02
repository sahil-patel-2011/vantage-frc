import { describe, expect, it } from "vitest";
import {
  SCOUT_QR_COMPRESSED_PREFIX,
  SCOUT_QR_EMBED_PREFIX,
  SCOUT_QR_MAX_EMBEDDED_BYTES,
  applyPendingToCoverage,
  decodeScoutQrContent,
  embeddedQrByteLength,
  encodeScoutQrPayload,
  needsShortCodeHandoff,
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

describe("QR scout handoff compression", () => {
  const batch = (count: number) =>
    syncEntriesToQrRecords(
      Array.from({ length: count }, (_, index) =>
        entry({
          clientId: `match-2026test_qm${index + 1}-frc${1000 + index}-${"0123456789abcdef".repeat(2)}`,
          matchKey: `2026test_qm${index + 1}`,
          teamKey: `frc${1000 + index}`,
          payload: {
            auto_score: 4 + index,
            teleop_score: 12 + index,
            endgame: index % 2 ? "full" : "partial",
            cycles: 7,
            defense: index % 3 === 0,
            disabled: false,
            notes: "clean cycles, slow climb, good driver",
          },
        }),
      ),
    );

  it("round-trips a compressed batch and still reads the legacy plain form", () => {
    const records = batch(6);
    const packed = encodeScoutQrPayload(records);
    expect(packed.startsWith(SCOUT_QR_COMPRESSED_PREFIX)).toBe(true);
    const decoded = decodeScoutQrContent(packed);
    if (decoded.kind !== "embedded") throw new Error("expected embedded");
    expect(decoded.records.map((row) => row.clientId)).toEqual(records.map((row) => row.clientId));
    expect(decoded.records[2]?.payload).toEqual(records[2]?.payload);

    const plain = encodeScoutQrPayload(records, { compress: false });
    expect(plain.startsWith(SCOUT_QR_EMBED_PREFIX)).toBe(true);
    const legacy = decodeScoutQrContent(plain);
    if (legacy.kind !== "embedded") throw new Error("expected embedded");
    expect(legacy.records).toEqual(decoded.records);
  });

  it("fits far more entries under the scan cap than the plain encoding", () => {
    const records = batch(10);
    expect(new TextEncoder().encode(encodeScoutQrPayload(records, { compress: false })).length).toBeGreaterThan(
      SCOUT_QR_MAX_EMBEDDED_BYTES,
    );
    expect(embeddedQrByteLength(records)).toBeLessThanOrEqual(SCOUT_QR_MAX_EMBEDDED_BYTES);
    expect(needsShortCodeHandoff(records)).toBe(false);
  });

  it("never grows a tiny payload just to say it compressed", () => {
    const one = syncEntriesToQrRecords([entry({ clientId: "c1", teamKey: "frc254", payload: { a: 1 } })]);
    const encoded = encodeScoutQrPayload(one);
    expect(encoded.length).toBeLessThanOrEqual(encodeScoutQrPayload(one, { compress: false }).length);
  });
});

describe("QR scout handoff integration", () => {
  it("round-trips SyncEntries through embedded QR into import-sourced outbox rows", () => {
    const encoded = encodeScoutQrPayload(
      syncEntriesToQrRecords([
        entry({ clientId: "c1", teamKey: "frc254", payload: { auto: 3, climb: "high" } }),
      ]),
    );
    // Either the plain or the deflated embed form — both are scout payloads.
    expect(encoded.startsWith("vantage://scout")).toBe(true);
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
