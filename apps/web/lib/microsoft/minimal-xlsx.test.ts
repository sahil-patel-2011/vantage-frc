import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, minimalXlsx } from "./minimal-xlsx";

/** Walk the central directory of a ZIP and return each entry's name, CRC and bytes. */
function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: Array<{ name: string; crc: number; data: Uint8Array }> = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const start = localOffset + 30 + localNameLength;
    entries.push({ name, crc, data: bytes.subarray(start, start + size) });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe("minimalXlsx", () => {
  it("is a valid ZIP containing the Office Open XML parts Excel requires", () => {
    const entries = readZip(minimalXlsx());
    expect(entries.map((e) => e.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
      "xl/styles.xml",
    ]);
    for (const entry of entries) {
      expect(crc32(entry.data)).toBe(entry.crc);
      expect(new TextDecoder().decode(entry.data)).toMatch(/^<\?xml/);
    }
    const workbook = new TextDecoder().decode(entries.find((e) => e.name === "xl/workbook.xml")!.data);
    expect(workbook).toContain('<sheet name="SyncInfo"');
  });

  it("is byte-for-byte deterministic", () => {
    expect(Buffer.from(minimalXlsx()).equals(Buffer.from(minimalXlsx()))).toBe(true);
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const zcrc = (zlib as unknown as { crc32?: (data: Uint8Array) => number }).crc32;
    if (zcrc) {
      const sample = new TextEncoder().encode("Vantage workbook");
      expect(crc32(sample)).toBe(zcrc(sample));
    }
  });
});
