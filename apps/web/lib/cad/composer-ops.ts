/** Native Onshape ops the human CAD composer can edit. Mirrors agent-policy names. */

export const COMPOSER_NATIVE_OPS = [
  "create_sketch",
  "create_extrude",
  "create_fillet",
  "create_hole",
  "create_part_studio",
  "create_assembly",
  "add_assembly_instance",
  "create_mate",
  "verify_topology",
  "export_step",
] as const;

export type ComposerNativeOp = (typeof COMPOSER_NATIVE_OPS)[number];

export type ComposerOp = {
  id: string;
  operation: ComposerNativeOp;
  parameters: Record<string, unknown>;
  reason: string;
};

export type SerializedComposerOp = {
  operation: ComposerNativeOp;
  parameters: Record<string, unknown>;
  reason: string;
};

export type ComposerFieldKind = "mm" | "signedMm" | "text" | "select" | "checkbox" | "idList";

export type ComposerFieldSpec = {
  key: string;
  label: string;
  kind: ComposerFieldKind;
  options?: readonly { value: string; label: string }[];
  help?: string;
};

const FUSION_NATIVE_OPS: readonly ComposerNativeOp[] = [
  "create_sketch",
  "create_extrude",
  "create_fillet",
  "verify_topology",
  "export_step",
];

const POSITIVE_MM_ALIASES: Record<string, string> = {
  width: "widthMm",
  height: "heightMm",
  depth: "depthMm",
  radius: "radiusMm",
  diameter: "diameterMm",
};

const POSITIVE_MM_BY_OP: Record<ComposerNativeOp, readonly string[]> = {
  create_sketch: ["widthMm", "heightMm"],
  create_extrude: ["depthMm"],
  create_fillet: ["radiusMm"],
  create_hole: ["diameterMm", "depthMm"],
  create_part_studio: [],
  create_assembly: [],
  add_assembly_instance: [],
  create_mate: [],
  verify_topology: [],
  export_step: [],
};

const SIGNED_MM_BY_OP: Record<ComposerNativeOp, readonly string[]> = {
  create_sketch: [],
  create_extrude: [],
  create_fillet: [],
  create_hole: [],
  create_part_studio: [],
  create_assembly: [],
  add_assembly_instance: [],
  create_mate: [
    "firstOffsetXMm",
    "firstOffsetYMm",
    "firstOffsetZMm",
    "secondOffsetXMm",
    "secondOffsetYMm",
    "secondOffsetZMm",
  ],
  verify_topology: [],
  export_step: [],
};

const LIST_KEYS = new Set(["entities", "edgeIds", "views"]);

const SKETCH_PLANES = [
  { value: "Top", label: "Top" },
  { value: "Front", label: "Front" },
  { value: "Right", label: "Right" },
] as const;

const EXTRUDE_TYPES = [
  { value: "NEW", label: "New" },
  { value: "ADD", label: "Add" },
  { value: "REMOVE", label: "Remove" },
  { value: "INTERSECT", label: "Intersect" },
] as const;

const HOLE_ENDS = [
  { value: "THROUGH", label: "Through" },
  { value: "BLIND", label: "Blind" },
] as const;

const MATE_TYPES = [
  { value: "FASTENED", label: "Fastened" },
  { value: "REVOLUTE", label: "Revolute" },
  { value: "SLIDER", label: "Slider" },
  { value: "CYLINDRICAL", label: "Cylindrical" },
] as const;

export const COMPOSER_OP_FIELDS: Record<ComposerNativeOp, readonly ComposerFieldSpec[]> = {
  create_sketch: [
    { key: "plane", label: "Plane", kind: "select", options: SKETCH_PLANES },
    { key: "widthMm", label: "Width", kind: "mm", help: "Millimetres. Leave blank until you measure." },
    { key: "heightMm", label: "Height", kind: "mm", help: "Millimetres. Leave blank until you measure." },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_extrude: [
    { key: "depthMm", label: "Depth", kind: "mm", help: "Extrude distance in millimetres." },
    { key: "sketchFeatureId", label: "Sketch feature ID", kind: "text" },
    { key: "operationType", label: "Operation", kind: "select", options: EXTRUDE_TYPES },
    { key: "oppositeDirection", label: "Opposite direction", kind: "checkbox" },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_fillet: [
    { key: "radiusMm", label: "Radius", kind: "mm", help: "Fillet radius in millimetres." },
    { key: "entities", label: "Edges", kind: "idList", help: "Comma-separated edge IDs from describe / list entities." },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_hole: [
    { key: "diameterMm", label: "Diameter", kind: "mm", help: "Hole diameter in millimetres." },
    { key: "endStyle", label: "End", kind: "select", options: HOLE_ENDS },
    { key: "depthMm", label: "Depth", kind: "mm", help: "Required for blind holes. Leave blank for through." },
    { key: "pointSketchFeatureId", label: "Point sketch feature ID", kind: "text" },
    { key: "targetFeatureId", label: "Target solid feature ID", kind: "text" },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_part_studio: [{ key: "name", label: "Name", kind: "text" }],
  create_assembly: [{ key: "name", label: "Name", kind: "text" }],
  add_assembly_instance: [
    { key: "assemblyElementId", label: "Assembly element ID", kind: "text" },
    { key: "sourceElementId", label: "Source element ID", kind: "text" },
    { key: "partId", label: "Part ID", kind: "text" },
    { key: "sourceDocumentId", label: "Source document ID", kind: "text" },
    { key: "isAssembly", label: "Source is an assembly", kind: "checkbox" },
  ],
  create_mate: [
    { key: "assemblyElementId", label: "Assembly element ID", kind: "text" },
    { key: "mateType", label: "Mate type", kind: "select", options: MATE_TYPES },
    { key: "name", label: "Name", kind: "text" },
    { key: "firstInstanceId", label: "First instance ID", kind: "text" },
    { key: "secondInstanceId", label: "Second instance ID", kind: "text" },
    { key: "firstFaceId", label: "First face ID", kind: "text" },
    { key: "secondFaceId", label: "Second face ID", kind: "text" },
    { key: "firstOffsetXMm", label: "First offset X", kind: "signedMm" },
    { key: "firstOffsetYMm", label: "First offset Y", kind: "signedMm" },
    { key: "firstOffsetZMm", label: "First offset Z", kind: "signedMm" },
    { key: "secondOffsetXMm", label: "Second offset X", kind: "signedMm" },
    { key: "secondOffsetYMm", label: "Second offset Y", kind: "signedMm" },
    { key: "secondOffsetZMm", label: "Second offset Z", kind: "signedMm" },
  ],
  verify_topology: [
    { key: "views", label: "Views", kind: "idList", help: "Comma-separated view names, e.g. iso, top, front." },
    { key: "explainForStudents", label: "Explain for students", kind: "checkbox" },
  ],
  export_step: [],
};

export function isComposerNativeOp(value: string): value is ComposerNativeOp {
  return (COMPOSER_NATIVE_OPS as readonly string[]).includes(value);
}

/** Default palette. Fusion only sees the native ops the add-in can run. Never includes feature_script. */
export function composerPalette(platform?: string): ComposerNativeOp[] {
  if (platform === "fusion360") return [...FUSION_NATIVE_OPS];
  return [...COMPOSER_NATIVE_OPS];
}

/** Empty feature-dialog values. Never invents DEMO plate sizes. */
export function emptyComposerParameters(_operation?: ComposerNativeOp): Record<string, unknown> {
  return {};
}

export function describeComposerOp(operation: ComposerNativeOp): string {
  switch (operation) {
    case "create_sketch":
      return "Sketch rectangle";
    case "create_extrude":
      return "Extrude";
    case "create_fillet":
      return "Fillet";
    case "create_hole":
      return "Hole";
    case "create_part_studio":
      return "Part studio";
    case "create_assembly":
      return "Assembly";
    case "add_assembly_instance":
      return "Instance";
    case "create_mate":
      return "Mate";
    case "verify_topology":
      return "Verify topology";
    case "export_step":
      return "Export STEP";
  }
}

export function summarizeComposerParams(operation: ComposerNativeOp, parameters: Record<string, unknown>): string {
  const parts: string[] = [];
  const width = asFiniteNumber(parameters.widthMm);
  const height = asFiniteNumber(parameters.heightMm);
  const depth = asFiniteNumber(parameters.depthMm);
  const radius = asFiniteNumber(parameters.radiusMm);
  const diameter = asFiniteNumber(parameters.diameterMm);
  if (operation === "create_sketch" && width != null && height != null) {
    parts.push(`${formatMm(width)} × ${formatMm(height)} mm`);
  } else {
    if (width != null) parts.push(`W ${formatMm(width)} mm`);
    if (height != null) parts.push(`H ${formatMm(height)} mm`);
  }
  if (diameter != null) parts.push(`⌀ ${formatMm(diameter)} mm`);
  if (radius != null) parts.push(`R ${formatMm(radius)} mm`);
  if (depth != null && operation !== "create_sketch") parts.push(`${formatMm(depth)} mm deep`);
  const plane = stringOrEmpty(parameters.plane);
  if (plane) parts.push(plane);
  const mateType = stringOrEmpty(parameters.mateType);
  if (mateType) parts.push(mateType);
  const name = stringOrEmpty(parameters.name);
  if (name) parts.push(name);
  return parts.join(" · ") || "No dimensions yet";
}

/**
 * Accept a stored plan, JSON string, or `{ steps | ops | plan }`.
 * Empty input stays `[]`. Unknown ops (including feature_script) are dropped.
 * Present millimetre fields must be finite numbers — unit strings like `30 mm` are rejected.
 */
export function parseComposerOps(input: unknown): ComposerOp[] {
  const raw = coercePlanArray(input);
  if (!raw.length) return [];
  const used = new Set<string>();
  const ops: ComposerOp[] = [];
  for (const [index, entry] of raw.entries()) {
    const parsed = parseOneOp(entry, index);
    if (!parsed) continue;
    const id = uniqueId(parsed.id, used, index);
    used.add(id);
    ops.push({ ...parsed, id });
  }
  return ops;
}

export function serializeComposerOps(ops: readonly ComposerOp[]): SerializedComposerOp[] {
  return ops.map((op) => ({
    operation: op.operation,
    parameters: compactParameters(op.parameters),
    reason: op.reason.trim(),
  }));
}

export function appendComposerOp(plan: readonly ComposerOp[], draft: Omit<ComposerOp, "id"> & { id?: string }): ComposerOp[] {
  const [parsed] = parseComposerOps([{ ...draft, id: draft.id ?? nextComposerOpId(plan) }]);
  if (!parsed) throw new Error("Nothing to add — choose a native operation");
  return [...plan, parsed];
}

export function replaceComposerOp(plan: readonly ComposerOp[], id: string, draft: Omit<ComposerOp, "id"> & { id?: string }): ComposerOp[] {
  const index = plan.findIndex((op) => op.id === id);
  if (index < 0) throw new Error("That planned step is gone");
  const [parsed] = parseComposerOps([{ ...draft, id }]);
  if (!parsed) throw new Error("Nothing to save — choose a native operation");
  const next = [...plan];
  next[index] = parsed;
  return next;
}

export function removeComposerOp(plan: readonly ComposerOp[], id: string): ComposerOp[] {
  return plan.filter((op) => op.id !== id);
}

export function nextComposerOpId(plan: readonly ComposerOp[]): string {
  const used = new Set(plan.map((op) => op.id));
  let n = plan.length + 1;
  while (used.has(`step-${n}`)) n += 1;
  return `step-${n}`;
}

/** Parse a typed millimetre field. Empty stays empty; invalid values throw. */
export function parsePositiveMm(value: unknown, label: string): number | undefined {
  if (isEmptyMm(value)) return undefined;
  const parsed = parseBareNumber(value);
  if (parsed == null || parsed <= 0) {
    throw new Error(`${label} must be a positive number in millimetres`);
  }
  return parsed;
}

export function parseSignedMm(value: unknown, label: string): number | undefined {
  if (isEmptyMm(value)) return undefined;
  const parsed = parseBareNumber(value);
  if (parsed == null) {
    throw new Error(`${label} must be a number in millimetres`);
  }
  return parsed;
}

export function parametersFromDraft(
  operation: ComposerNativeOp,
  draft: Record<string, string | boolean>,
): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const field of COMPOSER_OP_FIELDS[operation]) {
    const raw = draft[field.key];
    if (field.kind === "checkbox") {
      if (raw === true || raw === "true") parameters[field.key] = true;
      continue;
    }
    const text = raw == null ? "" : String(raw);
    if (field.kind === "mm") {
      const parsed = parsePositiveMm(text, field.label);
      if (parsed != null) parameters[field.key] = parsed;
      continue;
    }
    if (field.kind === "signedMm") {
      const parsed = parseSignedMm(text, field.label);
      if (parsed != null) parameters[field.key] = parsed;
      continue;
    }
    if (field.kind === "idList") {
      const list = asStringArray(text);
      if (list) parameters[field.key] = list;
      continue;
    }
    if (text.trim()) parameters[field.key] = text.trim();
  }
  return parameters;
}

export function draftFromParameters(operation: ComposerNativeOp, parameters: Record<string, unknown>): Record<string, string | boolean> {
  const draft: Record<string, string | boolean> = {};
  for (const field of COMPOSER_OP_FIELDS[operation]) {
    const value = parameters[field.key];
    if (field.kind === "checkbox") {
      draft[field.key] = value === true || value === "true";
      continue;
    }
    if (value == null || value === "") {
      draft[field.key] = "";
      continue;
    }
    if (Array.isArray(value)) {
      draft[field.key] = value.map((item) => String(item).trim()).filter(Boolean).join(", ");
      continue;
    }
    draft[field.key] = String(value);
  }
  return draft;
}

export function emptyComposerDraft(operation: ComposerNativeOp): Record<string, string | boolean> {
  return draftFromParameters(operation, emptyComposerParameters(operation));
}

function coercePlanArray(input: unknown): unknown[] {
  if (input == null || input === "") return [];
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("CAD operation plan is not valid JSON");
    }
    return coercePlanArray(parsed);
  }
  if (Array.isArray(input)) return input;
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record.operation === "string") return [input];
    const nested = record.steps ?? record.ops ?? record.plan ?? record.actions;
    if (nested == null || nested === "") return [];
    if (Array.isArray(nested)) return nested;
    throw new Error("CAD operation plan must be an array");
  }
  throw new Error("CAD operation plan must be an array");
}

function parseOneOp(entry: unknown, index: number): ComposerOp | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`CAD operation step ${index + 1} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const operation = String(record.operation ?? "");
  if (!isComposerNativeOp(operation)) return null;
  const parameters = normalizeParameters(operation, record.parameters);
  const reason = String(record.reason ?? "").trim();
  const id = String(record.id ?? record.stepId ?? "").trim() || `step-${index + 1}`;
  return { id, operation, parameters, reason };
}

function normalizeParameters(operation: ComposerNativeOp, raw: unknown): Record<string, unknown> {
  const source = asParamRecord(raw);
  const aliased: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const canonical = POSITIVE_MM_ALIASES[key] ?? key;
    if (aliased[canonical] === undefined) aliased[canonical] = value;
  }
  const parameters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(aliased)) {
    if (LIST_KEYS.has(key)) {
      const list = asStringArray(value);
      if (list) parameters[key] = list;
      continue;
    }
    if (POSITIVE_MM_BY_OP[operation].includes(key)) {
      const parsed = parsePositiveMm(value, mmLabel(key));
      if (parsed != null) parameters[key] = parsed;
      continue;
    }
    if (SIGNED_MM_BY_OP[operation].includes(key)) {
      const parsed = parseSignedMm(value, mmLabel(key));
      if (parsed != null) parameters[key] = parsed;
      continue;
    }
    if (isEmptyMm(value)) continue;
    parameters[key] = value;
  }
  return compactParameters(parameters);
}

function asParamRecord(value: unknown): Record<string, unknown> {
  if (value == null || value === "") return {};
  if (typeof value === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Parameters must be a JSON object");
    }
    return asParamRecord(parsed);
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error("Parameters must be an object");
}

function compactParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (value == null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    next[key] = value;
  }
  return next;
}

function asStringArray(value: unknown): string[] | undefined {
  if (value == null || value === "") return undefined;
  const items = Array.isArray(value) ? value : String(value).split(",");
  const cleaned = items.map((item) => String(item).trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

function isEmptyMm(value: unknown): boolean {
  return value == null || value === "" || (typeof value === "string" && !value.trim());
}

/** Bare millimetre number only — `30` or `"30.5"`, never `"30 mm"`. */
function parseBareNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

function mmLabel(key: string): string {
  return key.replace(/Mm$/, "").replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function uniqueId(preferred: string, used: Set<string>, index: number): string {
  if (preferred && !used.has(preferred)) return preferred;
  let n = index + 1;
  let candidate = preferred ? `${preferred}-${n}` : `step-${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = preferred ? `${preferred}-${n}` : `step-${n}`;
  }
  return candidate;
}
