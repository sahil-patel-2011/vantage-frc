import { describe, expect, it } from "vitest";
import { acadReleaseName, parseDxf, plainMtext, readPairs, sniffCadFile } from "./dxf";
import { BARE_SKETCH, EMPTY_DRAWING, GOOD_DRAWING, HIDDEN_LAYERS } from "./fixtures";

const bytes = (text: string) => new TextEncoder().encode(text);

function drawingOf(text: string) {
  const result = parseDxf(text);
  if (!result.ok) throw new Error(result.reason);
  return result.drawing;
}

describe("sniffCadFile", () => {
  it("spots DWG by its AC10xx magic even with the wrong extension", () => {
    expect(sniffCadFile("plate.dxf", bytes("AC1032\0\0\0\0"))).toEqual({ kind: "dwg", version: "AC1032" });
  });
  it("spots DWG by extension when the bytes are unreadable", () => {
    expect(sniffCadFile("plate.DWG", new Uint8Array([0, 1, 2]))).toEqual({ kind: "dwg", version: null });
  });
  it("spots binary DXF by its sentinel", () => {
    expect(sniffCadFile("plate.dxf", bytes("AutoCAD Binary DXF\r\n\u001a\0"))).toEqual({ kind: "binary-dxf" });
  });
  it("accepts ASCII DXF by extension or by its first group code", () => {
    expect(sniffCadFile("plate.dxf", bytes("  0\nSECTION\n"))).toEqual({ kind: "dxf" });
    expect(sniffCadFile("plate.txt", bytes("  0\nSECTION\n"))).toEqual({ kind: "dxf" });
    expect(sniffCadFile("photo.png", bytes("\u0089PNG\r\n"))).toEqual({ kind: "other" });
  });
});

describe("readPairs", () => {
  it("reads code / value lines with CRLF and padding", () => {
    expect(readPairs("  0\r\nSECTION\r\n  2\r\nHEADER\r\n")).toEqual([
      { code: 0, value: "SECTION" },
      { code: 2, value: "HEADER" },
    ]);
  });
  it("refuses text that is not code / value pairs", () => {
    expect(readPairs(Array.from({ length: 60 }, (_, i) => `word ${i}`).join("\n"))).toBeNull();
  });
});

describe("parseDxf", () => {
  it("refuses an empty file, a binary DXF and plain text, with a reason", () => {
    expect(parseDxf("")).toEqual({ ok: false, reason: "The file is empty." });
    expect(parseDxf("AutoCAD Binary DXF\r\n").ok).toBe(false);
    expect(parseDxf("0\nHELLO\n").ok).toBe(false);
  });

  it("reads header variables", () => {
    const d = drawingOf(GOOD_DRAWING);
    expect(d.header).toEqual({ insunits: 1, measurement: 0, acadver: "AC1015", dimscale: 1, ltscale: 1 });
    expect(acadReleaseName(d.header.acadver)).toBe("AutoCAD 2000");
  });

  it("reads the layer table with colour, linetype, frozen and off", () => {
    const d = drawingOf(HIDDEN_LAYERS);
    expect(d.layers.map((l) => l.name)).toEqual(["0", "Cut", "Old revision", "Notes", "Spare"]);
    expect(d.layers.find((l) => l.name === "Old revision")).toMatchObject({ frozen: true, off: false });
    expect(d.layers.find((l) => l.name === "Notes")).toMatchObject({ frozen: false, off: true, color: 2, linetype: "CONTINUOUS" });
  });

  it("reads blocks with their attribute tags and inserts with their attributes", () => {
    const d = drawingOf(GOOD_DRAWING);
    expect(d.blocks).toEqual([
      { name: "TITLE_BLOCK", attdefTags: ["TITLE", "DRAWN_BY", "DATE", "SCALE", "MATERIAL", "REV"], entityCount: 7 },
    ]);
    expect(d.inserts).toEqual([{ block: "TITLE_BLOCK", layer: "Title", attribTags: ["TITLE", "MATERIAL"] }]);
    expect(d.layersUsedInBlocks).toEqual(["Title"]);
  });

  it("counts drawn entities by type and layer, without ATTRIB / SEQEND", () => {
    const d = drawingOf(GOOD_DRAWING);
    expect(d.entityCounts).toEqual({ LINE: 2, CIRCLE: 1, DIMENSION: 1, TEXT: 1, MTEXT: 1, INSERT: 1 });
    expect(d.layerCounts).toEqual({ Outline: 2, Holes: 1, Dimensions: 3, Title: 1 });
    expect(d.totalEntities).toBe(7);
  });

  it("keeps text heights and plain MTEXT", () => {
    const d = drawingOf(GOOD_DRAWING);
    const mtext = d.texts.find((t) => t.type === "MTEXT");
    expect(mtext).toMatchObject({ height: 0.1, value: "BREAK ALL SHARP EDGES" });
    expect(d.texts.find((t) => t.type === "TEXT")).toMatchObject({ height: 0.12, value: "ALL HOLES #10 CLEARANCE" });
  });

  it("reads a drawing with nothing drawn", () => {
    const d = drawingOf(EMPTY_DRAWING);
    expect(d.totalEntities).toBe(0);
    expect(d.layers).toHaveLength(1);
  });

  it("reads an R12-style file without $INSUNITS", () => {
    const d = drawingOf(BARE_SKETCH);
    expect(d.header.insunits).toBe(0);
    expect(d.layerCounts).toEqual({ "0": 4 });
  });
});

describe("plainMtext", () => {
  it("strips formatting codes and turns %% codes into symbols", () => {
    expect(plainMtext("{\\H2.5;\\fArial|b1;HOLE}\\P%%c6.35 THRU")).toBe("HOLE Ø6.35 THRU");
  });
});
