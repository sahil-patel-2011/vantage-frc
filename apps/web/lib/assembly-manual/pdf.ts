import { deflateSync, inflateSync } from "node:zlib";

/**
 * A minimal PDF 1.4 writer, and a PNG decoder to feed it.
 *
 * No PDF library is installed in this repo and adding one for a single feature
 * is a lot of dependency for "draw text, lines and pictures on A4". So this is
 * the whole file format, written out by hand: a header, numbered objects, a
 * cross-reference table whose byte offsets have to be exactly right, a trailer,
 * and %%EOF.
 *
 * The xref offsets are the part that silently breaks. A PDF with a wrong offset
 * opens fine in some readers (they rebuild the table) and fails in others,
 * which is the worst kind of bug: it works on the laptop of whoever wrote it.
 * `pdf.test.ts` therefore re-parses the produced bytes, walks the xref table,
 * and asserts every offset lands on the "N 0 obj" it claims to.
 *
 * WHY THE PNG DECODER
 *
 * PDF can embed a PNG's compressed data directly with a predictor, but only for
 * the colour types that happen to line up, and Onshape's shaded views are RGBA.
 * Rather than ship something that works for some renders and not others, PNGs
 * are decoded to raw RGB here (alpha composited over white, because this is
 * paper) and re-deflated. Deterministic, testable, no native dependency.
 */

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

export type RgbImage = { width: number; height: number; rgb: Buffer };

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode an 8-bit, non-interlaced PNG to RGB. Returns null for anything else —
 * the caller then prints the "no render" placeholder rather than a corrupt
 * image, which is the same honesty rule the rest of the engine follows.
 */
export function decodePng(bytes: Buffer): RgbImage | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let paletteAlpha: Buffer | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    const data = bytes.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      if (length < 13) return null;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      paletteAlpha = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !idat.length) return null;

  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) return null;
  if (colorType === 3 && !palette) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }

  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  const lines = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const source = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = source[x]!;
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      let out: number;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + left; break;
        case 2: out = value + up; break;
        case 3: out = value + ((left + up) >> 1); break;
        case 4: out = value + paeth(left, up, upLeft); break;
        default: return null;
      }
      current[x] = out & 0xff;
    }
    current.copy(lines, y * stride);
    previous = current;
  }

  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    const target = i * 3;
    let r: number;
    let g: number;
    let b: number;
    let alpha = 255;
    if (colorType === 0) {
      r = g = b = lines[source]!;
    } else if (colorType === 2) {
      r = lines[source]!;
      g = lines[source + 1]!;
      b = lines[source + 2]!;
    } else if (colorType === 3) {
      const index = lines[source]!;
      r = palette![index * 3] ?? 0;
      g = palette![index * 3 + 1] ?? 0;
      b = palette![index * 3 + 2] ?? 0;
      alpha = paletteAlpha?.[index] ?? 255;
    } else if (colorType === 4) {
      r = g = b = lines[source]!;
      alpha = lines[source + 1]!;
    } else {
      r = lines[source]!;
      g = lines[source + 1]!;
      b = lines[source + 2]!;
      alpha = lines[source + 3]!;
    }
    // Composited onto white: the manual is printed.
    const mix = alpha / 255;
    rgb[target] = Math.round(r * mix + 255 * (1 - mix));
    rgb[target + 1] = Math.round(g * mix + 255 * (1 - mix));
    rgb[target + 2] = Math.round(b * mix + 255 * (1 - mix));
  }

  return { width, height, rgb };
}

// ---------------------------------------------------------------------------
// Font metrics (Adobe base-14, so no font file has to be embedded)
// ---------------------------------------------------------------------------

const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Width of one line of text in points. */
export function textWidth(text: string, sizePt: number, bold = false): number {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let units = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    // Everything outside the printable ASCII range is sanitised to "?" before
    // it reaches the page, so it measures as "?".
    units += code >= 32 && code <= 126 ? table[code - 32]! : table[31]!;
  }
  return (units * sizePt) / 1000;
}

/**
 * PDF's base-14 Helvetica with WinAnsiEncoding covers Latin-1, but this engine
 * prints part names straight out of a team's CAD, which can contain anything.
 * Rather than emit bytes the reader will render as mojibake, non-ASCII is
 * transliterated where there is an obvious equivalent and replaced otherwise.
 */
export function sanitizeText(text: string): string {
  return String(text ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[×✕]/g, "x")
    .replace(/Ø/g, "dia ")
    .replace(/°/g, " deg")
    .replace(/[^\x20-\x7e]/g, "?");
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Greedy word wrap against the real Helvetica metrics. */
export function wrapText(text: string, widthPt: number, sizePt: number, bold = false): string[] {
  const clean = sanitizeText(text);
  const words = clean.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, sizePt, bold) <= widthPt || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

export type PageSize = { widthPt: number; heightPt: number };

/** US Letter, because this is printed in an American high-school shop. */
export const LETTER: PageSize = { widthPt: 612, heightPt: 792 };

type PdfObject = { id: number; body: Buffer };

type PageState = {
  content: string[];
  images: Array<{ name: string; objectId: number }>;
};

export class PdfWriter {
  private readonly objects: PdfObject[] = [];
  private readonly pages: PageState[] = [];
  private nextId = 1;
  private current: PageState | null = null;

  constructor(readonly size: PageSize = LETTER) {}

  private reserve(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  private put(id: number, body: string | Buffer): number {
    this.objects.push({ id, body: typeof body === "string" ? Buffer.from(body, "latin1") : body });
    return id;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  newPage(): void {
    this.current = { content: [], images: [] };
    this.pages.push(this.current);
  }

  private page(): PageState {
    if (!this.current) this.newPage();
    return this.current!;
  }

  /** y is measured from the TOP of the page, which is how layout code thinks. */
  text(x: number, yFromTop: number, value: string, options: { size?: number; bold?: boolean; gray?: number } = {}): void {
    const size = options.size ?? 10;
    const y = this.size.heightPt - yFromTop;
    const font = options.bold ? "/F2" : "/F1";
    const gray = options.gray ?? 0;
    this.page().content.push(
      `q ${gray} g BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(sanitizeText(value))}) Tj ET Q`,
    );
  }

  line(x1: number, y1FromTop: number, x2: number, y2FromTop: number, options: { widthPt?: number; gray?: number } = {}): void {
    const y1 = this.size.heightPt - y1FromTop;
    const y2 = this.size.heightPt - y2FromTop;
    this.page().content.push(
      `q ${options.gray ?? 0.7} G ${(options.widthPt ?? 0.5).toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`,
    );
  }

  rect(
    x: number,
    yFromTop: number,
    width: number,
    height: number,
    options: { fillGray?: number; strokeGray?: number; widthPt?: number } = {},
  ): void {
    const y = this.size.heightPt - yFromTop - height;
    const parts = [`q`];
    if (options.fillGray !== undefined) parts.push(`${options.fillGray} g`);
    if (options.strokeGray !== undefined) parts.push(`${options.strokeGray} G ${(options.widthPt ?? 0.5).toFixed(2)} w`);
    parts.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`);
    parts.push(options.fillGray !== undefined && options.strokeGray !== undefined ? "B" : options.fillGray !== undefined ? "f" : "S");
    parts.push("Q");
    this.page().content.push(parts.join(" "));
  }

  /**
   * Place a decoded image. Returns false when the bytes were not a PNG this
   * decoder understands — the caller then draws its placeholder instead.
   */
  image(png: Buffer, x: number, yFromTop: number, widthPt: number, heightPt: number): boolean {
    const decoded = decodePng(png);
    if (!decoded) return false;
    const id = this.reserve();
    const compressed = deflateSync(decoded.rgb, { level: 9 });
    const header =
      `<< /Type /XObject /Subtype /Image /Width ${decoded.width} /Height ${decoded.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`;
    this.put(id, Buffer.concat([Buffer.from(header, "latin1"), compressed, Buffer.from("\nendstream", "latin1")]));

    const page = this.page();
    const name = `Im${id}`;
    page.images.push({ name, objectId: id });
    const y = this.size.heightPt - yFromTop - heightPt;
    page.content.push(
      `q ${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`,
    );
    return true;
  }

  /** Fit an image inside a box, preserving aspect ratio. */
  imageFit(png: Buffer, x: number, yFromTop: number, boxWidth: number, boxHeight: number): boolean {
    const decoded = decodePng(png);
    if (!decoded) return false;
    const scale = Math.min(boxWidth / decoded.width, boxHeight / decoded.height);
    const width = decoded.width * scale;
    const height = decoded.height * scale;
    return this.image(png, x + (boxWidth - width) / 2, yFromTop + (boxHeight - height) / 2, width, height);
  }

  build(): Buffer {
    const catalogId = this.reserve();
    const pagesId = this.reserve();
    const fontRegularId = this.reserve();
    const fontBoldId = this.reserve();

    const pageIds: number[] = [];
    for (const page of this.pages) {
      const contentId = this.reserve();
      const pageId = this.reserve();
      pageIds.push(pageId);

      const stream = page.content.join("\n");
      this.put(
        contentId,
        `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
      );

      const xobjects = page.images.length
        ? ` /XObject << ${page.images.map((image) => `/${image.name} ${image.objectId} 0 R`).join(" ")} >>`
        : "";
      this.put(
        pageId,
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.size.widthPt} ${this.size.heightPt}] ` +
          `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${xobjects} >> ` +
          `/Contents ${contentId} 0 R >>`,
      );
    }

    this.put(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    this.put(
      pagesId,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    );
    this.put(fontRegularId, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
    this.put(fontBoldId, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

    // --- serialise ------------------------------------------------------
    const chunks: Buffer[] = [];
    let position = 0;
    const append = (buffer: Buffer) => {
      chunks.push(buffer);
      position += buffer.length;
    };

    // The binary comment on line 2 is what tells transfer tools this is not text.
    append(Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1"));

    const offsets = new Map<number, number>();
    const ordered = [...this.objects].sort((a, b) => a.id - b.id);
    for (const object of ordered) {
      offsets.set(object.id, position);
      append(Buffer.from(`${object.id} 0 obj\n`, "latin1"));
      append(object.body);
      append(Buffer.from("\nendobj\n", "latin1"));
    }

    const xrefOffset = position;
    const count = this.nextId; // object 0 plus every allocated id
    const xref: string[] = [`xref\n0 ${count}\n`, "0000000000 65535 f \n"];
    for (let id = 1; id < count; id += 1) {
      const offset = offsets.get(id);
      // Every id we reserved is written; a hole would be a bug, and a free
      // entry here is the honest encoding of one rather than a wrong offset.
      xref.push(
        offset === undefined
          ? "0000000000 65535 f \n"
          : `${offset.toString().padStart(10, "0")} 00000 n \n`,
      );
    }
    append(Buffer.from(xref.join(""), "latin1"));
    append(
      Buffer.from(
        `trailer\n<< /Size ${count} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
        "latin1",
      ),
    );

    return Buffer.concat(chunks);
  }
}

// ---------------------------------------------------------------------------
// Manual layout
// ---------------------------------------------------------------------------

export type ManualPdfStep = {
  stepNumber: number;
  subassembly: string;
  title: string;
  sentence: string;
  parts: Array<{ name: string; quantity: number; detail: string }>;
  fabrication: Array<{ text: string; confirmed: boolean }>;
  notes: string[];
  /** Raw PNG bytes, or null when the step has no render. */
  png: Buffer | null;
  renderNote: string;
};

export type ManualPdfInput = {
  teamName: string;
  assemblyName: string;
  generatedAt: Date;
  coverPng: Buffer | null;
  coverNote: string;
  cutList: Array<{
    partName: string;
    material: string | null;
    quantity: number;
    length: string | null;
    profile: string | null;
    confirmed: boolean;
  }>;
  hardware: Array<{ partName: string; quantity: number }>;
  steps: ManualPdfStep[];
  report: {
    checksRun: number;
    checksPassed: number;
    disagreements: number;
    unresolved: number;
    strategyUsed: string;
    notes: string[];
    gaps: string[];
  };
};

const MARGIN = 54;
const CONTENT_WIDTH = LETTER.widthPt - MARGIN * 2;

function footer(writer: PdfWriter, label: string): void {
  writer.line(MARGIN, LETTER.heightPt - 48, LETTER.widthPt - MARGIN, LETTER.heightPt - 48, { gray: 0.8 });
  writer.text(MARGIN, LETTER.heightPt - 36, label, { size: 8, gray: 0.45 });
}

/**
 * Compose the whole book. Layout is deliberately plain — one step per page,
 * picture on top, callout and fabrication under it — because the reader is
 * holding this next to a partly-built robot, not admiring it.
 */
export function renderManualPdf(input: ManualPdfInput): Buffer {
  const writer = new PdfWriter(LETTER);
  const stamp = input.generatedAt.toISOString().slice(0, 16).replace("T", " ");

  // --- cover -------------------------------------------------------------
  writer.newPage();
  writer.text(MARGIN, 96, "Assembly manual", { size: 26, bold: true });
  writer.text(MARGIN, 126, input.assemblyName, { size: 16 });
  writer.text(MARGIN, 148, input.teamName, { size: 11, gray: 0.4 });
  writer.text(MARGIN, 164, `Generated ${stamp} UTC from Onshape`, { size: 9, gray: 0.45 });

  if (input.coverPng && writer.imageFit(input.coverPng, MARGIN, 190, CONTENT_WIDTH, 330)) {
    // rendered
  } else {
    writer.rect(MARGIN, 190, CONTENT_WIDTH, 120, { strokeGray: 0.75 });
    for (const [index, line] of wrapText(
      input.coverNote || "No Onshape render of the finished assembly was available.",
      CONTENT_WIDTH - 24,
      10,
    ).entries()) {
      writer.text(MARGIN + 12, 216 + index * 14, line, { size: 10, gray: 0.35 });
    }
  }

  let y = input.coverPng ? 540 : 330;
  writer.text(MARGIN, y, "Read this first", { size: 12, bold: true });
  y += 18;
  for (const line of [
    "Every measurement in this book came out of the CAD. Nothing was estimated.",
    'A line that ends "confirm - not specified in CAD" means the model does not say, and a human has to decide before you cut.',
    `The build order passed ${input.report.checksPassed} of ${input.report.checksRun} feasibility checks. ${input.report.unresolved} step(s) are unresolved - see the report at the back.`,
  ]) {
    for (const wrapped of wrapText(line, CONTENT_WIDTH, 10)) {
      writer.text(MARGIN, y, wrapped, { size: 10 });
      y += 13;
    }
    y += 4;
  }
  footer(writer, `${input.assemblyName} - assembly manual - page 1`);

  // --- cut list ----------------------------------------------------------
  const listPages = paginate(input.cutList, 30);
  for (const [pageIndex, rows] of listPages.entries()) {
    writer.newPage();
    writer.text(MARGIN, 72, pageIndex === 0 ? "Materials and cut list" : "Materials and cut list (continued)", {
      size: 16,
      bold: true,
    });
    let rowY = 104;
    writer.text(MARGIN, rowY, "Part", { size: 9, bold: true });
    writer.text(MARGIN + 220, rowY, "Qty", { size: 9, bold: true });
    writer.text(MARGIN + 256, rowY, "Length", { size: 9, bold: true });
    writer.text(MARGIN + 330, rowY, "Section", { size: 9, bold: true });
    writer.text(MARGIN + 424, rowY, "Material", { size: 9, bold: true });
    writer.line(MARGIN, rowY + 4, LETTER.widthPt - MARGIN, rowY + 4, { gray: 0.6 });
    rowY += 16;

    for (const row of rows) {
      writer.text(MARGIN, rowY, truncate(row.partName, 210, 9), { size: 9 });
      writer.text(MARGIN + 220, rowY, String(row.quantity), { size: 9 });
      writer.text(MARGIN + 256, rowY, row.length ?? "-", { size: 9 });
      writer.text(MARGIN + 330, rowY, row.profile ?? "-", { size: 9 });
      writer.text(MARGIN + 424, rowY, truncate(row.material ?? "-", 130, 9), { size: 9 });
      if (!row.confirmed) {
        rowY += 11;
        writer.text(MARGIN + 12, rowY, "confirm - not specified in CAD", { size: 8, gray: 0.35 });
      }
      rowY += 15;
    }
    footer(writer, `${input.assemblyName} - materials`);
  }

  if (input.hardware.length) {
    for (const [pageIndex, rows] of paginate(input.hardware, 34).entries()) {
      writer.newPage();
      writer.text(MARGIN, 72, pageIndex === 0 ? "Hardware" : "Hardware (continued)", { size: 16, bold: true });
      let rowY = 104;
      writer.text(MARGIN, rowY, "Part", { size: 9, bold: true });
      writer.text(MARGIN + 380, rowY, "Qty", { size: 9, bold: true });
      writer.line(MARGIN, rowY + 4, LETTER.widthPt - MARGIN, rowY + 4, { gray: 0.6 });
      rowY += 16;
      for (const row of rows) {
        writer.text(MARGIN, rowY, truncate(row.partName, 370, 9), { size: 9 });
        writer.text(MARGIN + 380, rowY, String(row.quantity), { size: 9 });
        rowY += 14;
      }
      footer(writer, `${input.assemblyName} - hardware`);
    }
  }

  // --- steps -------------------------------------------------------------
  for (const step of input.steps) {
    writer.newPage();
    writer.text(MARGIN, 70, `Step ${step.stepNumber}`, { size: 22, bold: true });
    if (step.subassembly) writer.text(MARGIN + 110, 70, step.subassembly, { size: 11, gray: 0.4 });

    const imageBoxTop = 88;
    const imageBoxHeight = 300;
    let placed = false;
    if (step.png) placed = writer.imageFit(step.png, MARGIN, imageBoxTop, CONTENT_WIDTH, imageBoxHeight);
    if (!placed) {
      writer.rect(MARGIN, imageBoxTop, CONTENT_WIDTH, 96, { strokeGray: 0.75 });
      writer.text(MARGIN + 12, imageBoxTop + 24, "No render for this step", { size: 11, bold: true, gray: 0.3 });
      for (const [index, line] of wrapText(step.renderNote, CONTENT_WIDTH - 24, 9).slice(0, 4).entries()) {
        writer.text(MARGIN + 12, imageBoxTop + 44 + index * 12, line, { size: 9, gray: 0.4 });
      }
    }
    let cursor = imageBoxTop + (placed ? imageBoxHeight + 16 : 116);

    if (step.renderNote && placed) {
      for (const line of wrapText(step.renderNote, CONTENT_WIDTH, 8).slice(0, 2)) {
        writer.text(MARGIN, cursor, line, { size: 8, gray: 0.45 });
        cursor += 10;
      }
      cursor += 4;
    }

    for (const line of wrapText(step.sentence, CONTENT_WIDTH, 12)) {
      writer.text(MARGIN, cursor, line, { size: 12 });
      cursor += 16;
    }
    cursor += 6;

    if (step.parts.length) {
      writer.text(MARGIN, cursor, "Parts", { size: 10, bold: true });
      cursor += 14;
      for (const part of step.parts) {
        writer.text(MARGIN + 8, cursor, `${part.quantity} x  ${truncate(part.name, 300, 10)}`, { size: 10 });
        if (part.detail) writer.text(MARGIN + 330, cursor, truncate(part.detail, 170, 9), { size: 9, gray: 0.4 });
        cursor += 13;
      }
      cursor += 6;
    }

    if (step.fabrication.length) {
      writer.text(MARGIN, cursor, "Make", { size: 10, bold: true });
      cursor += 14;
      for (const line of step.fabrication) {
        for (const wrapped of wrapText(line.text, CONTENT_WIDTH - 16, 10)) {
          writer.text(MARGIN + 8, cursor, wrapped, { size: 10, gray: line.confirmed ? 0 : 0.35 });
          cursor += 13;
          if (cursor > LETTER.heightPt - 80) break;
        }
        if (cursor > LETTER.heightPt - 80) break;
      }
      cursor += 6;
    }

    for (const note of step.notes) {
      if (cursor > LETTER.heightPt - 70) break;
      for (const wrapped of wrapText(note, CONTENT_WIDTH, 9)) {
        writer.text(MARGIN, cursor, wrapped, { size: 9, gray: 0.4 });
        cursor += 11;
      }
    }
    footer(writer, `${input.assemblyName} - step ${step.stepNumber} of ${input.steps.length}`);
  }

  // --- report ------------------------------------------------------------
  writer.newPage();
  writer.text(MARGIN, 72, "How this manual was checked", { size: 16, bold: true });
  let reportY = 104;
  const summary = [
    `Build order strategy used: ${input.report.strategyUsed === "geometry" ? "geometry-first" : "mate dependency"}.`,
    `Feasibility checks: ${input.report.checksPassed} passed of ${input.report.checksRun} run.`,
    `The two ordering strategies disagreed on ${input.report.disagreements} step(s).`,
    `${input.report.unresolved} step(s) still fail a check and are marked in the book.`,
  ];
  for (const line of summary) {
    writer.text(MARGIN, reportY, line, { size: 10 });
    reportY += 14;
  }
  reportY += 8;

  if (input.report.notes.length) {
    writer.text(MARGIN, reportY, "Notes", { size: 11, bold: true });
    reportY += 15;
    for (const note of input.report.notes) {
      for (const wrapped of wrapText(note, CONTENT_WIDTH, 9)) {
        if (reportY > LETTER.heightPt - 70) break;
        writer.text(MARGIN, reportY, wrapped, { size: 9 });
        reportY += 11;
      }
      reportY += 3;
    }
    reportY += 6;
  }

  if (input.report.gaps.length && reportY < LETTER.heightPt - 120) {
    writer.text(MARGIN, reportY, "What the CAD could not tell us", { size: 11, bold: true });
    reportY += 15;
    for (const gap of input.report.gaps) {
      for (const wrapped of wrapText(gap, CONTENT_WIDTH, 9)) {
        if (reportY > LETTER.heightPt - 70) break;
        writer.text(MARGIN, reportY, wrapped, { size: 9, gray: 0.3 });
        reportY += 11;
      }
      reportY += 3;
    }
  }
  footer(writer, `${input.assemblyName} - run report`);

  return writer.build();
}

function truncate(text: string, widthPt: number, sizePt: number): string {
  const clean = sanitizeText(text);
  if (textWidth(clean, sizePt) <= widthPt) return clean;
  let result = clean;
  while (result.length > 1 && textWidth(`${result}...`, sizePt) > widthPt) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function paginate<T>(rows: T[], perPage: number): T[][] {
  if (!rows.length) return [[]];
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += perPage) {
    pages.push(rows.slice(index, index + perPage));
  }
  return pages;
}
