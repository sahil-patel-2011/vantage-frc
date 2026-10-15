/**
 * A small, tolerant reader for ASCII DXF drawings, run entirely in the browser.
 *
 * DXF is a list of group-code / value pairs, one per line: a number that says what the next line
 * means (0 = start of something, 2 = a name, 8 = a layer, 40 = a height…) and then its value.
 * This reads only what the CAD checker needs: a few HEADER variables, the LAYER table, block
 * names with their attribute tags, and per-entity type, layer, text height, text and inserts.
 * Anything it does not recognise is skipped, so a file from any CAD program still reads.
 *
 * It never guesses: a file that is not DXF comes back as `{ ok: false }` with a plain reason, and
 * the checker stops there instead of showing results.
 */

export type DxfPair = { code: number; value: string };

export type DxfHeader = {
  /** $INSUNITS: 0 unitless, 1 inches, 2 feet, 4 millimetres, 5 centimetres, 6 metres… Null when absent. */
  insunits: number | null;
  /** $MEASUREMENT: 0 imperial, 1 metric. Null when absent. */
  measurement: number | null;
  /** $ACADVER: the AutoCAD release the file was saved as, e.g. "AC1015". */
  acadver: string | null;
  dimscale: number | null;
  ltscale: number | null;
};

export type DxfLayer = {
  name: string;
  /** ACI colour; negative in the file means the layer is off (stored here as the absolute value). */
  color: number | null;
  linetype: string | null;
  frozen: boolean;
  off: boolean;
};

export type DxfBlock = {
  name: string;
  /** Tags of the ATTDEF fields inside the block (title blocks keep TITLE, DATE, SCALE…). */
  attdefTags: string[];
  entityCount: number;
};

export type DxfText = { type: "TEXT" | "MTEXT" | "ATTRIB" | "ATTDEF"; layer: string; height: number | null; value: string };

export type DxfInsert = { block: string; layer: string; attribTags: string[] };

export type DxfDrawing = {
  header: DxfHeader;
  layers: DxfLayer[];
  blocks: DxfBlock[];
  /** Drawn entities (model space plus paper-space layouts), by type. */
  entityCounts: Record<string, number>;
  /** Drawn entities by layer name. */
  layerCounts: Record<string, number>;
  /** Layers used by geometry inside block definitions (a layer used only there is not unused). */
  layersUsedInBlocks: string[];
  totalEntities: number;
  /** Text in the drawing, including text inside block definitions (title blocks often live there). */
  texts: DxfText[];
  inserts: DxfInsert[];
};

export type DxfParseResult = { ok: true; drawing: DxfDrawing } | { ok: false; reason: string };

export type CadFileKind =
  | { kind: "dxf" }
  | { kind: "binary-dxf" }
  | { kind: "dwg"; version: string | null }
  | { kind: "other" };

const BINARY_DXF_SENTINEL = "AutoCAD Binary DXF";
const DWG_MAGIC = /^AC(?:\d{4}|1\.\d{2}|2\.\d{2})/;

/**
 * What kind of file this is, from its name and first bytes. DWG files start with "AC10xx"
 * (the release code); binary DXF starts with a fixed sentinel line.
 */
export function sniffCadFile(name: string, head: Uint8Array): CadFileKind {
  const start = asciiPrefix(head, 32);
  if (start.startsWith(BINARY_DXF_SENTINEL)) return { kind: "binary-dxf" };
  const dwg = DWG_MAGIC.exec(start);
  if (dwg) return { kind: "dwg", version: dwg[0] };
  const lower = name.trim().toLowerCase();
  if (lower.endsWith(".dwg")) return { kind: "dwg", version: null };
  if (lower.endsWith(".dxf")) return { kind: "dxf" };
  // An ASCII DXF with another extension still starts with a group code line ("0" / "999").
  if (/^\s*(?:0|999)\s*\r?\n/.test(start)) return { kind: "dxf" };
  return { kind: "other" };
}

function asciiPrefix(bytes: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < Math.min(length, bytes.length); i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

/** The release names people know, for "saved as AutoCAD 2018". */
const ACAD_RELEASES: Record<string, string> = {
  AC1009: "AutoCAD R12",
  AC1012: "AutoCAD R13",
  AC1014: "AutoCAD R14",
  AC1015: "AutoCAD 2000",
  AC1018: "AutoCAD 2004",
  AC1021: "AutoCAD 2007",
  AC1024: "AutoCAD 2010",
  AC1027: "AutoCAD 2013",
  AC1032: "AutoCAD 2018",
};

export function acadReleaseName(code: string | null): string | null {
  if (!code) return null;
  return ACAD_RELEASES[code.trim().toUpperCase()] ?? null;
}

/**
 * Splits DXF text into group-code / value pairs. Returns null when it is not DXF: an odd line
 * count is tolerated (a trailing blank line), but group codes must be whole numbers.
 */
export function readPairs(text: string): DxfPair[] | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const pairs: DxfPair[] = [];
  let bad = 0;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeLine = lines[i]!.trim();
    if (!/^-?\d{1,4}$/.test(codeLine)) {
      bad += 1;
      // A stray blank line shifts every pair after it; re-align on the next line instead of failing.
      if (bad > 20) return null;
      i -= 1;
      continue;
    }
    const code = Number(codeLine);
    // Text (1) and long-MTEXT chunks (3) keep their spaces: a chunk can end mid-sentence.
    const raw = lines[i + 1]!;
    pairs.push({ code, value: code === 1 || code === 3 ? raw : raw.trim() });
  }
  return pairs.length ? pairs : null;
}

/** Drawn-entity types that are parts of another entity, not drawing objects of their own. */
const CHILD_ENTITIES = new Set(["ATTRIB", "SEQEND", "VERTEX"]);

function num(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** MTEXT keeps formatting codes in its text: \P new paragraph, {\fArial|b0;…}, \H2.5; and so on. */
export function plainMtext(raw: string): string {
  return raw
    .replace(/\\P/g, " ")
    .replace(/\\[ACFHQTWfhqtw][^;\\{}]*;/g, "")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/\\S([^;]*);/g, (_m, s: string) => s.replace(/[#^]/g, "/"))
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function blankDrawing(): DxfDrawing {
  return {
    header: { insunits: null, measurement: null, acadver: null, dimscale: null, ltscale: null },
    layers: [],
    blocks: [],
    entityCounts: {},
    layerCounts: {},
    layersUsedInBlocks: [],
    totalEntities: 0,
    texts: [],
    inserts: [],
  };
}

type RawEntity = { type: string; pairs: DxfPair[] };

/** Groups the pairs after a (0, X) marker into entities until the section or block ends. */
function collectEntities(pairs: DxfPair[], start: number, stopAt: Set<string>): { entities: RawEntity[]; next: number } {
  const entities: RawEntity[] = [];
  let i = start;
  let current: RawEntity | null = null;
  for (; i < pairs.length; i += 1) {
    const pair = pairs[i]!;
    if (pair.code === 0) {
      if (stopAt.has(pair.value)) break;
      current = { type: pair.value.toUpperCase(), pairs: [] };
      entities.push(current);
      continue;
    }
    current?.pairs.push(pair);
  }
  return { entities, next: i };
}

function first(entity: RawEntity, code: number): string | null {
  return entity.pairs.find((p) => p.code === code)?.value ?? null;
}

function textOf(entity: RawEntity): DxfText | null {
  const layer = first(entity, 8) ?? "0";
  if (entity.type === "TEXT" || entity.type === "ATTRIB" || entity.type === "ATTDEF") {
    // ATTDEF / ATTRIB: 1 is the default value, 2 the tag, 3 the prompt. Text is the value.
    return { type: entity.type, layer, height: num(first(entity, 40) ?? ""), value: (first(entity, 1) ?? "").trim() };
  }
  if (entity.type === "MTEXT") {
    // Long MTEXT is split across 3s (in order) ending with a 1.
    const chunks = entity.pairs.filter((p) => p.code === 3).map((p) => p.value);
    const raw = [...chunks, first(entity, 1) ?? ""].join("");
    return { type: "MTEXT", layer, height: num(first(entity, 40) ?? ""), value: plainMtext(raw) };
  }
  return null;
}

/** Most text a checker needs; long notes are trimmed so a huge file stays small in memory. */
const MAX_TEXT = 200;
const MAX_TEXTS = 5000;

/** Reads an ASCII DXF. A file that is not DXF, or has no sections at all, is refused with a reason. */
export function parseDxf(text: string): DxfParseResult {
  if (!text.trim()) return { ok: false, reason: "The file is empty." };
  if (text.startsWith(BINARY_DXF_SENTINEL)) {
    return { ok: false, reason: "This is a binary DXF. Save it again as an ASCII (text) DXF, then check that." };
  }
  const pairs = readPairs(text);
  if (!pairs) return { ok: false, reason: "This doesn't look like a DXF file. The lines aren't in DXF's code / value layout." };
  if (!pairs.some((p) => p.code === 0 && p.value === "SECTION")) {
    return { ok: false, reason: "This doesn't look like a DXF file. It has no SECTION markers." };
  }
  const drawing = blankDrawing();
  const blockLayers = new Set<string>();
  const addText = (t: DxfText | null) => {
    if (!t || drawing.texts.length >= MAX_TEXTS) return;
    drawing.texts.push({ ...t, value: t.value.slice(0, MAX_TEXT) });
  };

  /** Counts a drawn entity and remembers its text, insert and layer. */
  const countEntities = (entities: RawEntity[]) => {
    let lastInsert: DxfInsert | null = null;
    for (const entity of entities) {
      if (entity.type === "ATTRIB") {
        const tag = (first(entity, 2) ?? "").trim().toUpperCase();
        if (lastInsert && tag) lastInsert.attribTags.push(tag);
        addText(textOf(entity));
        continue;
      }
      if (CHILD_ENTITIES.has(entity.type)) {
        if (entity.type === "SEQEND") lastInsert = null;
        continue;
      }
      const layer = first(entity, 8) ?? "0";
      drawing.totalEntities += 1;
      drawing.entityCounts[entity.type] = (drawing.entityCounts[entity.type] ?? 0) + 1;
      drawing.layerCounts[layer] = (drawing.layerCounts[layer] ?? 0) + 1;
      if (entity.type === "INSERT") {
        lastInsert = { block: (first(entity, 2) ?? "").trim(), layer, attribTags: [] };
        drawing.inserts.push(lastInsert);
      } else {
        lastInsert = null;
      }
      addText(textOf(entity));
    }
  };

  let i = 0;
  while (i < pairs.length) {
    const pair = pairs[i]!;
    if (!(pair.code === 0 && pair.value === "SECTION")) {
      i += 1;
      continue;
    }
    const name = pairs[i + 1]?.code === 2 ? pairs[i + 1]!.value.toUpperCase() : "";
    i += 2;
    if (name === "HEADER") {
      let variable = "";
      for (; i < pairs.length && !(pairs[i]!.code === 0 && pairs[i]!.value === "ENDSEC"); i += 1) {
        const p = pairs[i]!;
        if (p.code === 9) {
          variable = p.value.toUpperCase();
          continue;
        }
        if (variable === "$INSUNITS" && p.code === 70) drawing.header.insunits = num(p.value);
        else if (variable === "$MEASUREMENT" && p.code === 70) drawing.header.measurement = num(p.value);
        else if (variable === "$ACADVER" && p.code === 1) drawing.header.acadver = p.value;
        else if (variable === "$DIMSCALE" && p.code === 40) drawing.header.dimscale = num(p.value);
        else if (variable === "$LTSCALE" && p.code === 40) drawing.header.ltscale = num(p.value);
      }
    } else if (name === "TABLES") {
      let table = "";
      for (; i < pairs.length && !(pairs[i]!.code === 0 && pairs[i]!.value === "ENDSEC"); i += 1) {
        const p = pairs[i]!;
        if (p.code === 0 && p.value === "TABLE") {
          table = pairs[i + 1]?.code === 2 ? pairs[i + 1]!.value.toUpperCase() : "";
          continue;
        }
        if (p.code === 0 && p.value === "ENDTAB") {
          table = "";
          continue;
        }
        if (table === "LAYER" && p.code === 0 && p.value === "LAYER") {
          const { entities, next } = collectEntities(pairs, i, new Set(["ENDTAB", "ENDSEC"]));
          for (const entry of entities) {
            if (entry.type !== "LAYER") continue;
            const layerName = first(entry, 2);
            if (layerName == null) continue;
            const color = num(first(entry, 62) ?? "");
            const flags = num(first(entry, 70) ?? "") ?? 0;
            drawing.layers.push({
              name: layerName,
              color: color == null ? null : Math.abs(color),
              linetype: first(entry, 6),
              frozen: (flags & 1) === 1,
              off: color != null && color < 0,
            });
          }
          i = next - 1;
        }
      }
    } else if (name === "BLOCKS") {
      for (; i < pairs.length && !(pairs[i]!.code === 0 && pairs[i]!.value === "ENDSEC"); i += 1) {
        const p = pairs[i]!;
        if (!(p.code === 0 && p.value === "BLOCK")) continue;
        const { entities, next } = collectEntities(pairs, i + 1, new Set(["ENDBLK", "ENDSEC"]));
        // The BLOCK header's own pairs come before its first entity.
        let j = i + 1;
        let blockName = "";
        for (; j < pairs.length && pairs[j]!.code !== 0; j += 1) {
          if (pairs[j]!.code === 2 && !blockName) blockName = pairs[j]!.value.trim();
        }
        const contents = entities;
        const attdefTags = contents
          .filter((e) => e.type === "ATTDEF")
          .map((e) => (first(e, 2) ?? "").trim().toUpperCase())
          .filter(Boolean);
        const drawn = contents.filter((e) => !CHILD_ENTITIES.has(e.type));
        drawing.blocks.push({ name: blockName, attdefTags, entityCount: drawn.length });
        // Paper-space layouts are stored as *Paper_Space blocks: what is in them is drawn.
        if (/^\*paper_space/i.test(blockName)) {
          countEntities(contents);
        } else if (!blockName.startsWith("*")) {
          for (const e of drawn) {
            const layer = first(e, 8) ?? "0";
            if (layer !== "0") blockLayers.add(layer);
          }
          for (const e of contents) addText(textOf(e));
        }
        i = next;
      }
    } else if (name === "ENTITIES") {
      const { entities, next } = collectEntities(pairs, i, new Set(["ENDSEC"]));
      countEntities(entities);
      i = next;
    }
  }
  drawing.layersUsedInBlocks = [...blockLayers];
  return { ok: true, drawing };
}

/** Plain names for the $INSUNITS codes a team is likely to meet. */
export const INSUNITS_NAMES: Record<number, string> = {
  0: "no units",
  1: "inches",
  2: "feet",
  3: "miles",
  4: "millimetres",
  5: "centimetres",
  6: "metres",
  7: "kilometres",
  8: "microinches",
  9: "mils",
  10: "yards",
  14: "decimetres",
};

/** Millimetres per drawing unit, for the units a shop drawing can sensibly use. */
export const MM_PER_UNIT: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 9: 0.0254, 14: 100 };
