/**
 * Drawing checks for a DXF, modelled on a CAD standards checker: each rule reads the parsed
 * drawing and says pass, warn or fail, why, and how to fix it — in words a new student follows.
 *
 * Rules and thresholds live in CAD_CHECK_RULES so a team can see (and later change) what is
 * checked without reading the logic. A result is only what the file says: a check that cannot
 * tell (no units, so no way to measure text) says so instead of guessing.
 */

import { INSUNITS_NAMES, MM_PER_UNIT, type DxfDrawing } from "./dxf";

export type CheckStatus = "pass" | "warn" | "fail";

export type CadCheckResult = {
  id: string;
  title: string;
  status: CheckStatus;
  why: string;
  fix: string;
};

export const CAD_CHECK_RULES = {
  /** Units a shop drawing should be in. Anything else is still named, with a warning. */
  shopUnits: [1, 4] as number[],
  /** Smallest readable text height at 1:1, in millimetres (about 0.08 in). */
  minTextHeightMm: 2,
  /** Above this share of geometry on layer 0, layers aren't really being used. */
  layerZeroWarnShare: 0.75,
  /** Names CAD programs give new layers before anyone renames them. */
  defaultLayerName: /^(?:layer\s*\d*|new\s*layer\s*\d*|untitled\s*\d*)$/i,
  /** Layers every DXF has that are never "unused clutter". */
  builtInLayers: ["0", "defpoints"],
  /** Title block fields, each found by an attribute tag or a label in the drawing's text. */
  titleBlockFields: [
    { id: "title", label: "Part name or title", words: ["TITLE", "PART NAME", "PART NUMBER", "PART NO", "NAME", "DESCRIPTION"] },
    { id: "drawn", label: "Drawn by", words: ["DRAWN BY", "DRAWNBY", "DRAWN", "AUTHOR", "DESIGNER"] },
    { id: "date", label: "Date", words: ["DATE"] },
    { id: "scale", label: "Scale", words: ["SCALE"] },
    { id: "material", label: "Material", words: ["MATERIAL", "MATL"] },
    { id: "rev", label: "Revision", words: ["REVISION", "REV"] },
  ],
  /** A block whose name says it is a title block or border. */
  titleBlockName: /title|border|frame|sheet|(?:^|[^a-z])tb(?:[^a-z]|$)/i,
  /** Fewer fields than this and there is no title block to speak of. */
  titleBlockMinFields: 2,
  /** Text that reads like a dimension value (12.50, Ø6.35, R3, 45°), for exploded dimensions. */
  dimensionLikeText: /^(?:[Ø⌀R]\s*)?\d*\.?\d+\s*(?:°|"|mm|in)?(?:\s*[±]\s*\d*\.?\d+)?$/,
} as const;

type Rules = typeof CAD_CHECK_RULES;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listNames(names: string[], max = 5): string {
  const shown = names.slice(0, max).map((n) => `“${n}”`);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

function isBuiltIn(name: string, rules: Rules): boolean {
  return (rules.builtInLayers as readonly string[]).includes(name.toLowerCase());
}

/* ------------------------------------------------------------------------- the checks */

export function checkUnits(d: DxfDrawing, rules: Rules = CAD_CHECK_RULES): CadCheckResult {
  const base = { id: "units", title: "Drawing units are set" };
  const fix =
    "In AutoCAD type UNITS and set Insertion scale to Inches or Millimeters. In Onshape or Fusion, pick inches or mm when you export the DXF, then export again.";
  const code = d.header.insunits;
  if (code == null || code === 0) {
    const hint = d.header.measurement === 0 ? " It only says it uses imperial defaults." : d.header.measurement === 1 ? " It only says it uses metric defaults." : "";
    return {
      ...base,
      status: "fail",
      why: `The file doesn't say what one unit means, so a laser cutter or machinist can't tell if 10 is 10 inches or 10 mm.${hint}`,
      fix,
    };
  }
  const name = INSUNITS_NAMES[code] ?? `unit code ${code}`;
  if (!rules.shopUnits.includes(code)) {
    return {
      ...base,
      status: "warn",
      why: `The drawing is in ${name}. Shops expect inches or millimetres, so sizes may come out wrong.`,
      fix,
    };
  }
  return { ...base, status: "pass", why: `The drawing is in ${name}.`, fix };
}

export function checkHasGeometry(d: DxfDrawing): CadCheckResult {
  const base = { id: "geometry", title: "Something is drawn" };
  if (d.totalEntities === 0) {
    return {
      ...base,
      status: "fail",
      why: "The file has no lines, arcs, text or anything else drawn in it.",
      fix: "Export again and make sure the part or drawing sheet is selected. In AutoCAD, check you saved the file you were drawing in.",
    };
  }
  const top = Object.entries(d.entityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, n]) => `${n} ${type.toLowerCase()}`)
    .join(", ");
  return { ...base, status: "pass", why: `Found ${plural(d.totalEntities, "object")}: ${top}.`, fix: "Nothing to fix." };
}

export function checkLayerZero(d: DxfDrawing, rules: Rules = CAD_CHECK_RULES): CadCheckResult {
  const base = { id: "layer-zero", title: "Geometry isn't all on layer 0" };
  const fix =
    "Make layers for each kind of thing (for example Outline, Holes, Dimensions, Title) and move the geometry onto them. Layer 0 is for parts of blocks.";
  const onZero = d.layerCounts["0"] ?? 0;
  const share = d.totalEntities ? onZero / d.totalEntities : 0;
  if (onZero === d.totalEntities) {
    return {
      ...base,
      status: "fail",
      why: "Everything is on layer 0, so nobody can hide, colour or print one kind of line on its own (like cut lines vs. notes).",
      fix,
    };
  }
  if (share > rules.layerZeroWarnShare) {
    return {
      ...base,
      status: "warn",
      why: `${Math.round(share * 100)}% of the drawing is on layer 0. Most of it isn't sorted onto layers yet.`,
      fix,
    };
  }
  const used = Object.keys(d.layerCounts).length;
  return { ...base, status: "pass", why: `Geometry is spread across ${plural(used, "layer")}.`, fix };
}

export function checkLayerNames(d: DxfDrawing, rules: Rules = CAD_CHECK_RULES): CadCheckResult {
  const base = { id: "layer-names", title: "Layers have real names" };
  const defaults = d.layers.map((l) => l.name).filter((name) => rules.defaultLayerName.test(name.trim()));
  if (defaults.length) {
    return {
      ...base,
      status: "warn",
      why: `${plural(defaults.length, "layer")} still ${defaults.length === 1 ? "has its" : "have their"} default name: ${listNames(defaults)}. The next person can't tell what's on ${defaults.length === 1 ? "it" : "them"}.`,
      fix: "Rename each layer for what it holds, like Outline, Holes, Bend lines or Dimensions.",
    };
  }
  return { ...base, status: "pass", why: "No layer is left with a default name like Layer1.", fix: "Nothing to fix." };
}

export function checkUnusedLayers(d: DxfDrawing, rules: Rules = CAD_CHECK_RULES): CadCheckResult {
  const base = { id: "unused-layers", title: "No empty layers" };
  const usedInBlocks = new Set(d.layersUsedInBlocks);
  const empty = d.layers
    .map((l) => l.name)
    .filter((name) => !isBuiltIn(name, rules) && !(d.layerCounts[name] ?? 0) && !usedInBlocks.has(name));
  if (empty.length) {
    return {
      ...base,
      status: "warn",
      why: `${plural(empty.length, "layer")} ${empty.length === 1 ? "has" : "have"} nothing on ${empty.length === 1 ? "it" : "them"}: ${listNames(empty)}. Empty layers make the drawing harder to read.`,
      fix: "In AutoCAD type PURGE and remove unused layers. In other programs, delete the empty layers before exporting.",
    };
  }
  return { ...base, status: "pass", why: "Every layer holds something.", fix: "Nothing to fix." };
}

export function checkHiddenLayers(d: DxfDrawing): CadCheckResult {
  const base = { id: "hidden-layers", title: "No hidden layers with geometry" };
  const usedInBlocks = new Set(d.layersUsedInBlocks);
  const hidden = d.layers.filter((l) => (l.frozen || l.off) && ((d.layerCounts[l.name] ?? 0) > 0 || usedInBlocks.has(l.name)));
  if (hidden.length) {
    const names = hidden.map((l) => `${l.name} (${l.frozen ? "frozen" : "off"})`);
    return {
      ...base,
      status: "warn",
      why: `${plural(hidden.length, "layer")} with geometry ${hidden.length === 1 ? "is" : "are"} hidden: ${listNames(names)}. Whoever opens the file may not see it, or may cut it without knowing.`,
      fix: "Turn the layer on and thaw it (AutoCAD: LAYER, then click the lightbulb and sun), or delete what's on it if it isn't needed.",
    };
  }
  return { ...base, status: "pass", why: "Nothing drawn is on a frozen or turned-off layer.", fix: "Nothing to fix." };
}

export function checkDimensions(d: DxfDrawing, rules: Rules = CAD_CHECK_RULES): CadCheckResult {
  const base = { id: "dimensions", title: "Dimensions are on the drawing" };
  const fix =
    "Add dimensions for every size the shop needs: overall size, hole sizes and hole positions. In Onshape or Fusion, add them on the drawing before exporting.";
  const count = d.entityCounts.DIMENSION ?? 0;
  if (count > 0) return { ...base, status: "pass", why: `Found ${plural(count, "dimension")}.`, fix: "Nothing to fix." };
  const numberLike = d.texts.filter((t) => (t.type === "TEXT" || t.type === "MTEXT") && rules.dimensionLikeText.test(t.value.trim())).length;
  if (numberLike > 0) {
    return {
      ...base,
      status: "warn",
      why: `There are no real dimensions, but ${plural(numberLike, "piece")} of text look${numberLike === 1 ? "s" : ""} like sizes. The dimensions may have been exploded into plain lines and text, which won't update if the part changes.`,
      fix: "Check every size by hand against the part. Next time, export with dimensions kept as dimensions.",
    };
  }
  return {
    ...base,
    status: "fail",
    why: "There are no dimensions, so whoever makes the part has to measure the drawing and guess.",
    fix,
  };
}

/** Which title block fields the drawing names, from attribute tags or labels in its text. */
export function findTitleBlockFields(d: DxfDrawing, rules: Rules = CAD_CHECK_RULES): { found: string[]; missing: string[]; namedBlock: string | null } {
  const normal = (value: string) => value.toUpperCase().replace(/[_:.\-/]/g, " ").replace(/\s+/g, " ").trim();
  const tags = new Set<string>();
  for (const block of d.blocks) for (const tag of block.attdefTags) tags.add(normal(tag));
  for (const insert of d.inserts) for (const tag of insert.attribTags) tags.add(normal(tag));
  // A title block label is its own short text ("DRAWN BY", "SCALE 1:1", "REV A"), so text only
  // counts when it starts with the label: a note that mentions a part somewhere does not.
  const texts = d.texts.map((t) => normal(t.value)).filter(Boolean);
  const startsWith = (value: string, word: string) => value === word || value.startsWith(`${word} `);
  const has = (word: string) => {
    const squashed = word.replace(/\s+/g, "");
    return [...tags].some((t) => startsWith(t, word) || t.replace(/\s+/g, "").startsWith(squashed)) || texts.some((t) => startsWith(t, word));
  };
  const found: string[] = [];
  const missing: string[] = [];
  for (const field of rules.titleBlockFields) {
    if (field.words.some(has)) found.push(field.label);
    else missing.push(field.label);
  }
  const insertedNames = new Set(d.inserts.map((i) => i.block));
  const namedBlock = d.blocks.find((b) => !b.name.startsWith("*") && rules.titleBlockName.test(b.name) && insertedNames.has(b.name))?.name ?? null;
  return { found, missing, namedBlock };
}

export function checkTitleBlock(d: DxfDrawing, rules: Rules = CAD_CHECK_RULES): CadCheckResult {
  const base = { id: "title-block", title: "There's a title block" };
  const fix =
    "Use a drawing template with a title block (Onshape and Fusion drawing templates have one), and fill in the part name, who drew it, the date, scale, material and revision.";
  const { found, missing, namedBlock } = findTitleBlockFields(d, rules);
  if (found.length < rules.titleBlockMinFields && !namedBlock) {
    return {
      ...base,
      status: "fail",
      why: "No title block found. Without one the shop doesn't know the part name, material, scale or which version this is.",
      fix,
    };
  }
  if (missing.length) {
    return {
      ...base,
      status: "warn",
      why: `${namedBlock ? `Found a title block (“${namedBlock}”)` : "Found a title block"}, but it's missing: ${missing.join(", ")}.`,
      fix: `Add ${missing.join(", ").toLowerCase()} to the title block.`,
    };
  }
  return { ...base, status: "pass", why: `The title block has ${found.join(", ").toLowerCase()}.`, fix: "Nothing to fix." };
}

export function checkTextHeight(d: DxfDrawing, rules: Rules = CAD_CHECK_RULES): CadCheckResult {
  const minMm = rules.minTextHeightMm;
  const minIn = (minMm / 25.4).toFixed(2);
  const base = { id: "text-height", title: "Text is big enough to read" };
  const fix = `Make notes and labels at least ${minMm} mm (${minIn} in) tall when printed at full size.`;
  const sized = d.texts.filter((t) => t.height != null && t.height > 0);
  if (!sized.length) {
    return { ...base, status: "pass", why: "There's no sized text in the drawing, so none of it is too small.", fix: "Nothing to fix." };
  }
  const mmPerUnit = d.header.insunits != null ? MM_PER_UNIT[d.header.insunits] : undefined;
  if (!mmPerUnit) {
    return {
      ...base,
      status: "warn",
      why: "Couldn't check: the drawing has no units set, so there's no way to tell how tall the text really is.",
      fix: "Set the drawing units (the first check), then check again.",
    };
  }
  const small = sized.filter((t) => t.height! * mmPerUnit < minMm - 1e-9);
  if (small.length) {
    const smallest = Math.min(...small.map((t) => t.height! * mmPerUnit));
    return {
      ...base,
      status: "warn",
      why: `${plural(small.length, "piece")} of text ${small.length === 1 ? "is" : "are"} smaller than ${minMm} mm (${minIn} in). The smallest is ${smallest.toFixed(2)} mm, which is hard to read on a printed drawing.`,
      fix,
    };
  }
  return { ...base, status: "pass", why: `All ${plural(sized.length, "piece")} of text ${sized.length === 1 ? "is" : "are"} at least ${minMm} mm (${minIn} in) tall.`, fix: "Nothing to fix." };
}

/* ------------------------------------------------------------------------- running them */

type CheckDef = { id: string; needsGeometry: boolean; run: (d: DxfDrawing) => CadCheckResult };

/** The checks in reading order. Ones that need geometry are skipped for an empty drawing. */
export const DRAWING_CHECKS: CheckDef[] = [
  { id: "units", needsGeometry: false, run: (d) => checkUnits(d) },
  { id: "geometry", needsGeometry: false, run: checkHasGeometry },
  { id: "layer-zero", needsGeometry: true, run: (d) => checkLayerZero(d) },
  { id: "layer-names", needsGeometry: true, run: (d) => checkLayerNames(d) },
  { id: "unused-layers", needsGeometry: true, run: (d) => checkUnusedLayers(d) },
  { id: "hidden-layers", needsGeometry: true, run: checkHiddenLayers },
  { id: "dimensions", needsGeometry: true, run: (d) => checkDimensions(d) },
  { id: "title-block", needsGeometry: true, run: (d) => checkTitleBlock(d) },
  { id: "text-height", needsGeometry: true, run: (d) => checkTextHeight(d) },
];

export type DrawingReport = {
  results: CadCheckResult[];
  passed: number;
  /** Checks not run because there is nothing drawn to check. */
  skipped: number;
};

const ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2 };

export function runDrawingChecks(d: DxfDrawing): DrawingReport {
  const empty = d.totalEntities === 0;
  const results = DRAWING_CHECKS.filter((c) => !(empty && c.needsGeometry)).map((c) => c.run(d));
  return {
    results,
    passed: results.filter((r) => r.status === "pass").length,
    skipped: DRAWING_CHECKS.length - results.length,
  };
}

/** Problems first (fail, then warn), each group in the checks' own order. */
export function sortForReading(results: CadCheckResult[]): CadCheckResult[] {
  return results
    .map((r, index) => ({ r, index }))
    .sort((a, b) => ORDER[a.r.status] - ORDER[b.r.status] || a.index - b.index)
    .map(({ r }) => r);
}

/** "7 of 9 checks pass", plus how many need fixing. */
export function summaryLine(report: DrawingReport): string {
  const total = report.results.length;
  const fails = report.results.filter((r) => r.status === "fail").length;
  const warns = report.results.filter((r) => r.status === "warn").length;
  const head = `${report.passed} of ${total} check${total === 1 ? "" : "s"} pass`;
  const parts = [fails ? `${fails} to fix` : "", warns ? `${warns} to look at` : ""].filter(Boolean);
  return parts.length ? `${head} · ${parts.join(", ")}` : head;
}
