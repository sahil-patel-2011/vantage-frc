import { describe, expect, it } from "vitest";
import { actionHistory, recordScoutAction } from "../src/index";
import { decodeScoutQrContent, SCOUT_QR_MAX_EMBEDDED_BYTES, type ScoutQrRecord } from "../src/qr-handoff";
import { addScoutQrPart, completeScoutQrTransfer, decodeScoutQrPart, encodeScoutQrFrames, SCOUT_QR_PART_PREFIX, type ScoutQrAssembly } from "../src/qr-transfer";

function report(): ScoutQrRecord {
  let payload: Record<string, unknown> = {};
  for (let index = 0; index < 8; index++) payload = recordScoutAction(payload, { ...payload, cycles: index % 3, note: `Synthetic observation ${index} — zéro` },
    { id: `action-${index}`, at: `2026-09-26T12:00:0${index}.123Z` });
  return { clientId: "report-id", eventKey: "2026test", matchKey: "2026test_qm1", teamKey: "frc6925", payload, updatedAt: "2026-09-26T12:00:09Z" };
}

describe("lossless offline QR sequences", () => {
  it("keeps small QR codes compatible with existing readers", async () => {
    const frames = await encodeScoutQrFrames([{ ...report(), payload: { cycles: 0 } }]);
    expect(frames).toHaveLength(1);
    expect(decodeScoutQrPart(frames[0]!)).toBeNull();
    expect(decodeScoutQrContent(frames[0]!).kind).toBe("embedded");
  });
  it("transfers complete timestamped history without a server, in any order", async () => {
    const original = report();
    const frames = await encodeScoutQrFrames([original]);
    expect(frames.length).toBeGreaterThan(1);
    let assembly: ScoutQrAssembly | null = null;
    for (const [index, frame] of [...frames].reverse().entries()) {
      expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(SCOUT_QR_MAX_EMBEDDED_BYTES);
      assembly = addScoutQrPart(assembly, decodeScoutQrPart(frame)!);
      if (index < frames.length - 1) expect(await completeScoutQrTransfer(assembly)).toBeNull();
    }
    const decoded = decodeScoutQrContent((await completeScoutQrTransfer(assembly!))!);
    if (decoded.kind !== "embedded") throw new Error("Expected complete embedded report");
    expect(decoded.records[0]).toEqual(original);
    expect(actionHistory(decoded.records[0]!.payload)?.events).toHaveLength(8);
    expect(actionHistory(decoded.records[0]!.payload)?.events[0]?.changes[0]?.after).toBe(0);
  });
  it("treats a repeated scan as the same part and rejects conflicting or mixed parts", async () => {
    const frames = await encodeScoutQrFrames([report()]);
    const part = decodeScoutQrPart(frames[0]!)!;
    const once = addScoutQrPart(null, part);
    expect(addScoutQrPart(once, part)).toEqual(once);
    expect(() => addScoutQrPart(once, { ...part, content: "different" })).toThrow(/conflicts/);
    expect(() => addScoutQrPart(once, { ...part, id: "b".repeat(64) })).toThrow(/different transfers/);
  });
  it("rejects complete corrupted transfers before decoding or importing reports", async () => {
    const frames = await encodeScoutQrFrames([report()]);
    let assembly: ScoutQrAssembly | null = null;
    for (const [index, frame] of frames.entries()) {
      const part = decodeScoutQrPart(frame)!;
      if (index === 0) part.content = "x" + part.content.slice(1);
      assembly = addScoutQrPart(assembly, part);
    }
    await expect(completeScoutQrTransfer(assembly!)).rejects.toThrow(/damaged/);
  });
  it("rejects invalid indices, excessive allocation and oversized batches", async () => {
    for (const suffix of ["0/2/abc", "3/2/abc", "1/257/abc", "1/2/" + "a".repeat(901), "1/2/%broken"]) {
      expect(() => decodeScoutQrPart(SCOUT_QR_PART_PREFIX + "a".repeat(64) + "/" + suffix)).toThrow(/invalid/);
    }
    await expect(encodeScoutQrFrames([{ ...report(), payload: { note: "a".repeat(200_000) } }])).rejects.toThrow(/too large/);
  });
});
