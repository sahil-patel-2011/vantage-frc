import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodePng,
  LETTER,
  PdfWriter,
  renderManualPdf,
  sanitizeText,
  textWidth,
  wrapText,
  type ManualPdfInput,
} from "./pdf";

/**
 * The PDF writer is the piece most likely to be subtly wrong, because a broken
 * cross-reference table produces a file that opens in the reader you happen to
 * test with and fails in the one the team prints from. So these tests do not
 * check "it produced bytes" — they re-parse the output, walk the xref, and
 * assert every offset lands on the object it claims.
 */

// --- a real PNG, built here so the decoder is tested against actual bytes ----

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function pixelAt(x: number, y: number, channel: number): number {
  if (channel === 0) return (x * 7) % 256;
  if (channel === 1) return (y * 11) % 256;
  if (channel === 2) return ((x + y) * 3) % 256;
  return 255;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * A `width` x `height` PNG whose pixels are `pixelAt`, encoded with a rotating
 * filter type per row. Encoding the filters for real (rather than writing raw
 * bytes and mislabelling the row) is what makes the decoder test meaningful:
 * the decoder has to undo Sub, Up, Average and Paeth to get the pixels back.
 */
function makePng(width: number, height: number, colorType: 2 | 6 = 6, rotateFilters = true): Buffer {
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        line[x * channels + channel] = pixelAt(x, y, channel);
      }
    }
    const filter = rotateFilters ? y % 5 : 0;
    const rowStart = y * (stride + 1);
    raw[rowStart] = filter;
    for (let i = 0; i < stride; i += 1) {
      const value = line[i]!;
      const left = i >= channels ? line[i - channels]! : 0;
      const up = previous[i]!;
      const upLeft = i >= channels ? previous[i - channels]! : 0;
      let encoded: number;
      switch (filter) {
        case 1: encoded = value - left; break;
        case 2: encoded = value - up; break;
        case 3: encoded = value - ((left + up) >> 1); break;
        case 4: encoded = value - paethPredictor(left, up, upLeft); break;
        default: encoded = value;
      }
      raw[rowStart + 1 + i] = encoded & 0xff;
    }
    previous = line;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- a small PDF parser, so the assertions are about the real bytes ---------

type ParsedPdf = {
  size: number;
  rootRef: number;
  startxref: number;
  offsets: Array<{ index: number; offset: number; free: boolean }>;
};

function parsePdf(pdf: Buffer): ParsedPdf {
  const text = pdf.toString("latin1");

  const startxrefMatch = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(text);
  expect(startxrefMatch, "trailer must end with startxref then %%EOF").toBeTruthy();
  const startxref = Number(startxrefMatch![1]);

  const trailerMatch = /trailer\s*<<([\s\S]*?)>>/.exec(text);
  expect(trailerMatch, "a trailer dictionary must be present").toBeTruthy();
  const size = Number(/\/Size\s+(\d+)/.exec(trailerMatch![1]!)![1]);
  const rootRef = Number(/\/Root\s+(\d+)\s+0\s+R/.exec(trailerMatch![1]!)![1]);

  const xrefHeader = /^xref\r?\n(\d+) (\d+)\r?\n/.exec(text.slice(startxref));
  expect(xrefHeader, "startxref must point at the literal 'xref' keyword").toBeTruthy();
  const first = Number(xrefHeader![1]);
  const count = Number(xrefHeader![2]);
  expect(first).toBe(0);

  const entriesStart = startxref + xrefHeader![0]!.length;
  const offsets: ParsedPdf["offsets"] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = text.slice(entriesStart + index * 20, entriesStart + index * 20 + 20);
    // Every entry is exactly 20 bytes: 10 offset, space, 5 gen, space, type, 2 EOL.
    expect(entry.length, `xref entry ${index} must be 20 bytes`).toBe(20);
    expect(entry, `xref entry ${index} shape`).toMatch(/^\d{10} \d{5} [nf] [\r\n]$/);
    offsets.push({
      index,
      offset: Number(entry.slice(0, 10)),
      free: entry[17] === "f",
    });
  }
  return { size, rootRef, startxref, offsets };
}

/** Assert that every in-use xref offset points at "<n> 0 obj". */
function assertXrefOffsets(pdf: Buffer, parsed: ParsedPdf): void {
  const text = pdf.toString("latin1");
  for (const entry of parsed.offsets) {
    if (entry.free) continue;
    expect(entry.offset).toBeGreaterThan(0);
    expect(entry.offset).toBeLessThan(pdf.length);
    const header = text.slice(entry.offset, entry.offset + 40);
    expect(header, `object ${entry.index} header at byte ${entry.offset}`).toMatch(
      new RegExp(`^${entry.index} 0 obj`),
    );
  }
}

describe("decodePng", () => {
  it("decodes an RGBA PNG to RGB of the right size", () => {
    const decoded = decodePng(makePng(6, 4, 6));
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(6);
    expect(decoded!.height).toBe(4);
    expect(decoded!.rgb.length).toBe(6 * 4 * 3);
  });

  it("undoes every PNG filter and returns the exact pixels that went in", () => {
    for (const rotate of [true, false]) {
      const decoded = decodePng(makePng(9, 7, 2, rotate))!;
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 9; x += 1) {
          const at = (y * 9 + x) * 3;
          expect(
            [decoded.rgb[at], decoded.rgb[at + 1], decoded.rgb[at + 2]],
            `pixel ${x},${y} (rotating filters: ${rotate})`,
          ).toEqual([pixelAt(x, y, 0), pixelAt(x, y, 1), pixelAt(x, y, 2)]);
        }
      }
    }
  });

  it("composites a transparent pixel onto white, because this is paper", () => {
    const raw = Buffer.alloc((2 * 4 + 1) * 1);
    raw[0] = 0;
    // Opaque red, then fully transparent red.
    raw.set([255, 0, 0, 255, 255, 0, 0, 0], 1);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const decoded = decodePng(png)!;
    expect([...decoded.rgb]).toEqual([255, 0, 0, 255, 255, 255]);
  });

  it("returns null rather than garbage for bytes that are not a PNG", () => {
    expect(decodePng(Buffer.from("not a png at all, honestly"))).toBeNull();
    expect(decodePng(Buffer.alloc(0))).toBeNull();
    // A valid header with a truncated body must not be half-decoded.
    expect(decodePng(makePng(4, 4).subarray(0, 30))).toBeNull();
  });
});

describe("text metrics", () => {
  it("measures Helvetica against its published widths", () => {
    // Adobe's published Helvetica metrics: M is 833/1000 em, i is 222, W is 944.
    expect(textWidth("M", 10)).toBeCloseTo(8.33, 5);
    expect(textWidth("MM", 10)).toBeCloseTo(16.66, 5);
    expect(textWidth("i", 10)).toBeCloseTo(2.22, 5);
    expect(textWidth("W", 10)).toBeCloseTo(9.44, 5);
    // Helvetica-Bold is wider at 'i' (278) than the regular face.
    expect(textWidth("i", 10, true)).toBeCloseTo(2.78, 5);
    // Size scales linearly.
    expect(textWidth("M", 20)).toBeCloseTo(16.66, 5);
    expect(textWidth("", 10)).toBe(0);
  });

  it("wraps to the width it was given and never loses a word", () => {
    const words = "the quick brown fox jumps over the lazy dog".split(" ");
    const lines = wrapText(words.join(" "), 60, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 10)).toBeLessThanOrEqual(60.001);
    expect(lines.join(" ").split(" ")).toEqual(words);
  });

  it("keeps a single word too wide to fit rather than dropping it", () => {
    expect(wrapText("supercalifragilistic", 10, 10)).toEqual(["supercalifragilistic"]);
  });

  it("transliterates what WinAnsi Helvetica cannot show", () => {
    expect(sanitizeText("Ø0.196 in")).toBe("dia 0.196 in");
    expect(sanitizeText("17.50 in × 2")).toBe("17.50 in x 2");
    expect(sanitizeText("confirm — not specified")).toBe("confirm - not specified");
    expect(sanitizeText("日本語")).toBe("???");
  });
});

describe("PdfWriter", () => {
  it("produces a structurally valid PDF with correct xref offsets", () => {
    const writer = new PdfWriter();
    writer.newPage();
    writer.text(50, 60, "Step 1", { size: 18, bold: true });
    writer.line(50, 70, 500, 70);
    writer.rect(50, 80, 200, 40, { strokeGray: 0.6 });
    writer.newPage();
    writer.text(50, 60, "Step 2");

    const pdf = writer.build();
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    // Line 2 is the binary comment that marks the file as non-text: "%" then
    // four bytes above 127.
    expect(pdf[8]).toBe(0x0a);
    expect(pdf[9]).toBe(0x25);
    for (const index of [10, 11, 12, 13]) expect(pdf[index]!).toBeGreaterThan(127);

    const parsed = parsePdf(pdf);
    assertXrefOffsets(pdf, parsed);

    // Object 0 is always the free head of the chain.
    expect(parsed.offsets[0]!.free).toBe(true);
    expect(parsed.offsets[0]!.index).toBe(0);
    // /Size counts object 0 plus every object written.
    expect(parsed.size).toBe(parsed.offsets.length);

    const text = pdf.toString("latin1");
    expect(text).toContain(`${parsed.rootRef} 0 obj\n<< /Type /Catalog`);
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("/Count 2");
    expect(text).toContain("/BaseFont /Helvetica-Bold");
    expect(text.match(/\/Type \/Page[^s]/g)).toHaveLength(2);
  });

  it("embeds a real image and points the page at it", () => {
    const writer = new PdfWriter();
    writer.newPage();
    expect(writer.imageFit(makePng(20, 10), 50, 100, 400, 300)).toBe(true);

    const pdf = writer.build();
    const parsed = parsePdf(pdf);
    assertXrefOffsets(pdf, parsed);

    const text = pdf.toString("latin1");
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Width 20");
    expect(text).toContain("/Height 10");
    expect(text).toContain("/ColorSpace /DeviceRGB");
    expect(text).toContain("/Filter /FlateDecode");
    // The image XObject is named in the page's resources and drawn in its
    // content stream — an object nothing references would never render.
    const name = /\/XObject << \/(Im\d+) /.exec(text)![1]!;
    expect(text).toContain(`/${name} Do`);
  });

  it("refuses bytes that are not a PNG instead of writing a broken XObject", () => {
    const writer = new PdfWriter();
    writer.newPage();
    expect(writer.image(Buffer.from("nope"), 0, 0, 10, 10)).toBe(false);
    const pdf = writer.build();
    expect(pdf.toString("latin1")).not.toContain("/Subtype /Image");
    assertXrefOffsets(pdf, parsePdf(pdf));
  });

  it("escapes parentheses and backslashes so a part name cannot break the syntax", () => {
    const writer = new PdfWriter();
    writer.newPage();
    writer.text(10, 10, "Plate (rev B) \\ left");
    const text = writer.build().toString("latin1");
    expect(text).toContain("(Plate \\(rev B\\) \\\\ left) Tj");
  });

  it("declares a content-stream length that matches the bytes it wrote", () => {
    const writer = new PdfWriter();
    writer.newPage();
    writer.text(10, 10, "Length check");
    const text = writer.build().toString("latin1");
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text)!;
    expect(Buffer.byteLength(match[2]!, "latin1")).toBe(Number(match[1]));
  });

  it("uses US Letter, which is what the shop's printer has", () => {
    expect(LETTER).toEqual({ widthPt: 612, heightPt: 792 });
    const writer = new PdfWriter();
    writer.newPage();
    expect(writer.build().toString("latin1")).toContain("/MediaBox [0 0 612 792]");
  });
});

describe("renderManualPdf", () => {
  const input: ManualPdfInput = {
    teamName: "Team 6925",
    assemblyName: "West Coast Drive",
    generatedAt: new Date("2026-02-14T09:30:00Z"),
    coverPng: makePng(40, 30),
    coverNote: "",
    cutList: [
      {
        partName: "1x1 box tube",
        material: "6061 aluminium",
        quantity: 4,
        length: "17.50 in",
        profile: "1.00 in x 1.00 in",
        confirmed: false,
      },
      { partName: "Gearbox plate", material: "6061", quantity: 2, length: "6.00 in", profile: null, confirmed: true },
    ],
    hardware: [{ partName: "10-32 x 1.00 SHCS", quantity: 24 }],
    steps: [
      {
        stepNumber: 1,
        subassembly: "Drive rail",
        title: "1x1 box tube",
        sentence: "Fit the 1x1 box tube against the gearbox plate.",
        parts: [{ name: "1x1 box tube", quantity: 1, detail: "17.50 in long" }],
        fabrication: [
          { text: "Cut 1.00 in x 1.00 in stock to 17.50 in", confirmed: true },
          { text: "Drill dia 0.196 in (#9) through, 4 places", confirmed: true },
          { text: "No material assigned in CAD - confirm - not specified in CAD", confirmed: false },
        ],
        notes: [],
        png: makePng(30, 20),
        renderNote: "",
      },
      {
        stepNumber: 2,
        subassembly: "",
        title: "Bearing block",
        sentence: "Fit the bearing block.",
        parts: [{ name: "Bearing block", quantity: 1, detail: "" }],
        fabrication: [],
        notes: ["Onshape reported no bounding box, so reach was not checked."],
        png: null,
        renderNote: "Onshape returned no shaded view for this step.",
      },
    ],
    report: {
      checksRun: 8,
      checksPassed: 7,
      disagreements: 2,
      unresolved: 1,
      strategyUsed: "mate",
      notes: ['Moved "Bearing block" from step 3 to step 2.'],
      gaps: ["Two parts have no bounding box."],
    },
  };

  it("builds a valid book with a page per step plus front and back matter", () => {
    const pdf = renderManualPdf(input);
    const parsed = parsePdf(pdf);
    assertXrefOffsets(pdf, parsed);

    const text = pdf.toString("latin1");
    // cover + cut list + hardware + 2 steps + report
    expect(text).toContain("/Count 6");
    expect(text).toContain("(Assembly manual) Tj");
    expect(text).toContain("(West Coast Drive) Tj");
    expect(text).toContain("(Step 1) Tj");
    expect(text).toContain("(Step 2) Tj");
    expect(text).toContain("(How this manual was checked) Tj");
  });

  it("prints the unconfirmed caveat on the cut list, where it matters most", () => {
    const text = renderManualPdf(input).toString("latin1");
    expect(text).toContain("(confirm - not specified in CAD) Tj");
  });

  it("prints a labelled placeholder for a step with no render, never a stand-in picture", () => {
    const text = renderManualPdf(input).toString("latin1");
    expect(text).toContain("(No render for this step) Tj");
    expect(text).toContain("Onshape returned no shaded view");
    // Exactly two images: the cover and step 1. Step 2 got none.
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(2);
  });

  it("reports the checks and the disagreements rather than only the good news", () => {
    const text = renderManualPdf(input).toString("latin1");
    expect(text).toContain("(Feasibility checks: 7 passed of 8 run.) Tj");
    expect(text).toContain("(The two ordering strategies disagreed on 2 step\\(s\\).) Tj");
    expect(text).toContain("(1 step\\(s\\) still fail a check and are marked in the book.) Tj");
  });

  it("stays valid with no steps, no images and no cut list", () => {
    const pdf = renderManualPdf({
      ...input,
      coverPng: null,
      coverNote: "Onshape returned no shaded view of the finished assembly.",
      cutList: [],
      hardware: [],
      steps: [],
    });
    assertXrefOffsets(pdf, parsePdf(pdf));
    expect(pdf.toString("latin1")).toContain("Onshape returned no shaded view");
  });

  it("is deterministic for the same input", () => {
    expect(renderManualPdf(input).equals(renderManualPdf(input))).toBe(true);
  });
});
