/** Native Onshape ops the human CAD composer can edit. Mirrors agent-policy names. */

export const COMPOSER_NATIVE_OPS = [
  "create_drawing",
  "label_drawing",
  "create_sketch",
  "create_extrude",
  "create_fillet",
  "create_chamfer",
  "create_shell",
  "create_hole",
  "create_pattern",
  "create_mirror",
  "create_revolve",
  "create_boolean",
  "create_part_studio",
  "create_assembly",
  "add_assembly_instance",
  "create_mate",
  "set_variable",
  "delete_feature",
  "verify_topology",
  "export_step",
  "export_stl",
  "export_gltf",
  "render_views",
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

export type ComposerFieldKind = "mm" | "signedMm" | "count" | "text" | "select" | "checkbox" | "idList";

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
  "create_chamfer",
  "verify_topology",
  "export_step",
];

const POSITIVE_MM_ALIASES: Record<string, string> = {
  width: "widthMm",
  height: "heightMm",
  depth: "depthMm",
  radius: "radiusMm",
  diameter: "diameterMm",
  thickness: "thicknessMm",
  spacing: "spacingMm",
};

const COUNT_ALIASES: Record<string, string> = {
  count: "instanceCount",
};

const LIST_ALIASES: Record<string, string> = {
  features: "featureIds",
  axis: "axisIds",
};

const POSITIVE_MM_BY_OP: Record<ComposerNativeOp, readonly string[]> = {
  create_drawing: ["widthMm", "heightMm", "depthMm"],
  label_drawing: [],
  create_sketch: ["widthMm", "heightMm"],
  create_extrude: ["depthMm"],
  create_fillet: ["radiusMm"],
  create_chamfer: ["widthMm"],
  create_shell: ["thicknessMm"],
  create_hole: ["diameterMm", "depthMm"],
  create_pattern: ["spacingMm"],
  create_mirror: [],
  create_revolve: [],
  create_boolean: [],
  create_part_studio: [],
  create_assembly: [],
  add_assembly_instance: [],
  create_mate: [],
  set_variable: [],
  delete_feature: [],
  verify_topology: [],
  export_step: [],
  export_stl: [],
  export_gltf: [],
  render_views: [],
};

const COUNT_BY_OP: Record<ComposerNativeOp, readonly string[]> = {
  create_drawing: [],
  label_drawing: [],
  create_sketch: [],
  create_extrude: [],
  create_fillet: [],
  create_chamfer: [],
  create_shell: [],
  create_hole: [],
  create_pattern: ["instanceCount"],
  create_mirror: [],
  create_revolve: [],
  create_boolean: [],
  create_part_studio: [],
  create_assembly: [],
  add_assembly_instance: [],
  create_mate: [],
  set_variable: [],
  delete_feature: [],
  verify_topology: [],
  export_step: [],
  export_stl: [],
  export_gltf: [],
  render_views: [],
};

const SIGNED_MM_BY_OP: Record<ComposerNativeOp, readonly string[]> = {
  create_drawing: [],
  label_drawing: [],
  create_sketch: [],
  create_extrude: [],
  create_fillet: [],
  create_chamfer: [],
  create_shell: [],
  create_hole: [],
  create_pattern: [],
  create_mirror: [],
  create_revolve: [],
  create_boolean: [],
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
  export_stl: [],
  export_gltf: [],
  render_views: [],
  set_variable: [],
  delete_feature: [],
};

const LIST_KEYS = new Set([
  "entities",
  "edgeIds",
  "faceIds",
  "bodyIds",
  "views",
  "featureIds",
  "axisIds",
  "planeIds",
  "sketchFeatureId",
  "toolBodyIds",
  "targetBodyIds",
]);

const SKETCH_PLANES = [
  { value: "Top", label: "Top" },
  { value: "Front", label: "Front" },
  { value: "Right", label: "Right" },
] as const;

const SKETCH_KINDS = [
  { value: "rectangle", label: "Rectangle" },
  { value: "circle", label: "Circle" },
  { value: "polyline", label: "Polyline" },
  { value: "points", label: "Hole points" },
] as const;

const BOOLEAN_TYPES = [
  { value: "UNION", label: "Union" },
  { value: "SUBTRACT", label: "Subtract" },
  { value: "INTERSECT", label: "Intersect" },
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

const ALLOWED_MATE_TYPES = MATE_TYPES.map((entry) => entry.value);

const PATTERN_KINDS = [
  { value: "linear", label: "Linear" },
  { value: "circular", label: "Circular" },
] as const;

const PATTERN_DIRECTIONS = [
  { value: "X", label: "X" },
  { value: "Y", label: "Y" },
  { value: "Z", label: "Z" },
] as const;

export const COMPOSER_OP_FIELDS: Record<ComposerNativeOp, readonly ComposerFieldSpec[]> = {
  create_drawing: [
    { key: "name", label: "Name", kind: "text", help: "Drawing tab name in Onshape." },
    {
      key: "widthMm",
      label: "Width",
      kind: "mm",
      help: "Controlling width from the brief. Make the drawing first, then cast from these millimetres. Do not invent.",
    },
    {
      key: "heightMm",
      label: "Height",
      kind: "mm",
      help: "Controlling height from the brief. Do not invent.",
    },
    {
      key: "depthMm",
      label: "Depth",
      kind: "mm",
      help: "Controlling depth from the brief. The solid copies this after the drawing.",
    },
    {
      key: "views",
      label: "Views",
      kind: "idList",
      help: "front, top, side, iso. Multiple faces when the part needs more than one drawing.",
    },
    {
      key: "notes",
      label: "Notes",
      kind: "idList",
      help: "Plain notes a person can CAD from. Do not invent sizes.",
    },
  ],
  label_drawing: [
    {
      key: "drawingElementId",
      label: "Drawing tab",
      kind: "text",
      help: "Drawing tab id from Make a drawing first. Do not invent an id.",
    },
    {
      key: "notes",
      label: "Notes",
      kind: "idList",
      help: "Plain notes a person can CAD from. Do not invent sizes.",
    },
  ],
  create_sketch: [
    { key: "plane", label: "Plane", kind: "select", options: SKETCH_PLANES },
    { key: "sketchKind", label: "Kind", kind: "select", options: SKETCH_KINDS },
    { key: "widthMm", label: "Width", kind: "mm", help: "Rectangle width in millimetres. Leave blank for a circle." },
    { key: "heightMm", label: "Height", kind: "mm", help: "Rectangle height in millimetres. Leave blank for a circle." },
    { key: "radiusMm", label: "Radius", kind: "mm", help: "Circle radius in millimetres. Leave blank for a rectangle." },
    {
      key: "points",
      label: "Points",
      kind: "text",
      help: "Millimetre pairs you measured: 0,0; 80,0; 80,40; 0,40. Do not invent corners.",
    },
    { key: "closed", label: "Closed loop", kind: "checkbox", help: "Close a polyline so it can be extruded." },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_extrude: [
    { key: "depthMm", label: "Depth", kind: "mm", help: "Extrude distance in millimetres." },
    {
      key: "sketchFeatureId",
      label: "Sketch feature ID",
      kind: "idList",
      help: "Sketch feature id from the Vantage feature tree. Leave blank to use the last sketch this session created.",
    },
    { key: "operationType", label: "Operation", kind: "select", options: EXTRUDE_TYPES },
    { key: "oppositeDirection", label: "Opposite direction", kind: "checkbox" },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_fillet: [
    { key: "radiusMm", label: "Radius", kind: "mm", help: "Fillet radius in millimetres." },
    { key: "entities", label: "Edges", kind: "idList", help: "Comma-separated edge IDs from describe / list entities." },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_chamfer: [
    { key: "widthMm", label: "Width", kind: "mm", help: "Chamfer width in millimetres." },
    { key: "entities", label: "Edges", kind: "idList", help: "Comma-separated edge IDs from describe / list entities." },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_shell: [
    { key: "thicknessMm", label: "Thickness", kind: "mm", help: "Wall thickness in millimetres." },
    {
      key: "faceIds",
      label: "Faces",
      kind: "idList",
      help: "Required face ids to open, from list-onshape-entities. Do not invent ids.",
    },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_hole: [
    { key: "diameterMm", label: "Diameter", kind: "mm", help: "Hole diameter in millimetres." },
    { key: "endStyle", label: "End", kind: "select", options: HOLE_ENDS },
    { key: "depthMm", label: "Depth", kind: "mm", help: "Required for blind holes. Leave blank for through." },
    {
      key: "faceIds",
      label: "Locations",
      kind: "idList",
      help: "Location, vertex, or face ids Onshape already listed — not FeatureScript.",
    },
    {
      key: "bodyIds",
      label: "Bodies (scope)",
      kind: "idList",
      help: "Onshape hole needs scope body ids.",
    },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_pattern: [
    {
      key: "featureIds",
      label: "Features",
      kind: "idList",
      help: "Comma-separated feature IDs from describe. Leave blank until you have real IDs.",
    },
    { key: "patternKind", label: "Kind", kind: "select", options: PATTERN_KINDS },
    { key: "spacingMm", label: "Spacing", kind: "mm", help: "Linear pitch in millimetres." },
    { key: "instanceCount", label: "Count", kind: "count", help: "Number of instances. Leave blank until you measure." },
    { key: "direction", label: "Direction", kind: "select", options: PATTERN_DIRECTIONS },
    { key: "oppositeDirection", label: "Opposite direction", kind: "checkbox" },
    {
      key: "axisIds",
      label: "Axis IDs",
      kind: "idList",
      help: "Comma-separated cylindrical-face IDs for circular patterns. Leave blank for linear.",
    },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_mirror: [
    {
      key: "featureIds",
      label: "Features",
      kind: "idList",
      help: "Comma-separated feature IDs from describe. Leave blank until you have real IDs.",
    },
    { key: "plane", label: "Plane", kind: "select", options: SKETCH_PLANES },
    {
      key: "planeIds",
      label: "Plane IDs",
      kind: "idList",
      help: "Comma-separated plane-face IDs from describe. Leave blank to use a standard plane.",
    },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_revolve: [
    {
      key: "sketchFeatureId",
      label: "Sketch feature ID",
      kind: "idList",
      help: "Sketch feature id from the Vantage feature tree. Leave blank to use the last sketch this session created.",
    },
    {
      key: "axisIds",
      label: "Axis",
      kind: "idList",
      help: "Edge or axis ids from list-onshape-entities. Do not invent ids.",
    },
    {
      key: "angleDeg",
      label: "Angle (deg)",
      kind: "text",
      help: "Positive degrees, max 360. Leave blank for a full revolution.",
    },
    { key: "operationType", label: "Operation", kind: "select", options: EXTRUDE_TYPES },
    { key: "oppositeDirection", label: "Opposite direction", kind: "checkbox" },
    { key: "name", label: "Name", kind: "text" },
  ],
  create_boolean: [
    { key: "operationType", label: "Operation", kind: "select", options: BOOLEAN_TYPES },
    {
      key: "toolBodyIds",
      label: "Tool bodies",
      kind: "idList",
      help: "Body ids from list-onshape-entities. Do not invent ids.",
    },
    {
      key: "targetBodyIds",
      label: "Target bodies",
      kind: "idList",
      help: "Required for subtract and intersect. Body ids from list-onshape-entities.",
    },
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
    {
      key: "firstInstanceId",
      label: "First instance ID",
      kind: "idList",
      help: "Instance ids from list-onshape-assembly.",
    },
    {
      key: "secondInstanceId",
      label: "Second instance ID",
      kind: "idList",
      help: "Instance ids from list-onshape-assembly.",
    },
    { key: "firstFaceId", label: "First face ID", kind: "idList", help: "Face ids from list-onshape-entities." },
    { key: "secondFaceId", label: "Second face ID", kind: "idList", help: "Face ids from list-onshape-entities." },
    { key: "firstOffsetXMm", label: "First offset X", kind: "signedMm" },
    { key: "firstOffsetYMm", label: "First offset Y", kind: "signedMm" },
    { key: "firstOffsetZMm", label: "First offset Z", kind: "signedMm" },
    { key: "secondOffsetXMm", label: "Second offset X", kind: "signedMm" },
    { key: "secondOffsetYMm", label: "Second offset Y", kind: "signedMm" },
    { key: "secondOffsetZMm", label: "Second offset Z", kind: "signedMm" },
  ],
  set_variable: [
    { key: "name", label: "Name", kind: "text", help: "Onshape variable identifier. Not FeatureScript." },
    {
      key: "expression",
      label: "Expression",
      kind: "text",
      help: 'Onshape expression with units, e.g. "25 mm". Not a millimetre number field.',
    },
    {
      key: "variableStudioElementId",
      label: "Variable Studio element ID",
      kind: "text",
      help: "Onshape Variable Studio tab. POST writes here — not FeatureScript, not a guessed Part Studio.",
    },
  ],
  delete_feature: [
    {
      key: "featureId",
      label: "Feature ID",
      kind: "idList",
      help: "Feature id from the Vantage feature tree.",
    },
  ],
  verify_topology: [
    { key: "views", label: "Views", kind: "idList", help: "Comma-separated view names, e.g. iso, top, front." },
    { key: "explainForStudents", label: "Explain for students", kind: "checkbox" },
  ],
  export_step: [],
  export_stl: [],
  export_gltf: [],
  render_views: [],
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
    case "create_drawing":
      return "Make a drawing first";
    case "label_drawing":
      return "Label the drawing";
    case "create_sketch":
      return "Sketch";
    case "create_extrude":
      return "Extrude";
    case "create_fillet":
      return "Fillet";
    case "create_chamfer":
      return "Chamfer";
    case "create_shell":
      return "Shell";
    case "create_hole":
      return "Hole";
    case "create_pattern":
      return "Pattern";
    case "create_mirror":
      return "Mirror";
    case "create_revolve":
      return "Revolve";
    case "create_boolean":
      return "Boolean";
    case "create_part_studio":
      return "Part studio";
    case "create_assembly":
      return "Assembly";
    case "add_assembly_instance":
      return "Instance";
    case "create_mate":
      return "Mate";
    case "set_variable":
      return "Variable";
    case "delete_feature":
      return "Delete feature";
    case "verify_topology":
      return "Verify topology";
    case "export_step":
      return "Export STEP";
    case "export_stl":
      return "Export STL";
    case "export_gltf":
      return "Export glTF";
    case "render_views":
      return "Render views";
    default: {
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}

export function summarizeComposerParams(operation: ComposerNativeOp, parameters: Record<string, unknown>): string {
  const parts: string[] = [];
  const width = asFiniteNumber(parameters.widthMm);
  const height = asFiniteNumber(parameters.heightMm);
  const depth = asFiniteNumber(parameters.depthMm);
  const radius = asFiniteNumber(parameters.radiusMm);
  const diameter = asFiniteNumber(parameters.diameterMm);
  const thickness = asFiniteNumber(parameters.thicknessMm);
  const spacing = asFiniteNumber(parameters.spacingMm);
  const instanceCount = asFiniteNumber(parameters.instanceCount);
  if (operation === "create_sketch" && stringOrEmpty(parameters.sketchKind) === "polyline") {
    const pointCount = Array.isArray(parameters.points)
      ? parameters.points.length
      : typeof parameters.points === "string" && parameters.points.trim()
        ? parameters.points.split(/[;|\n]+/).filter((chunk) => chunk.trim()).length
        : 0;
    if (pointCount) parts.push(`${pointCount} pts`);
    if (parameters.closed !== false) parts.push("closed");
  } else if (operation === "create_sketch" && width != null && height != null) {
    parts.push(`${formatMm(width)} × ${formatMm(height)} mm`);
  } else if (operation === "create_chamfer" && width != null) {
    parts.push(`${formatMm(width)} mm`);
  } else {
    if (width != null) parts.push(`W ${formatMm(width)} mm`);
    if (height != null) parts.push(`H ${formatMm(height)} mm`);
  }
  if (diameter != null) parts.push(`⌀ ${formatMm(diameter)} mm`);
  if (radius != null) parts.push(`R ${formatMm(radius)} mm`);
  if (thickness != null) parts.push(`${formatMm(thickness)} mm wall`);
  if (instanceCount != null) parts.push(`${formatMm(instanceCount)}×`);
  if (spacing != null) parts.push(`${formatMm(spacing)} mm pitch`);
  if (depth != null && operation !== "create_sketch") parts.push(`${formatMm(depth)} mm deep`);
  const plane = stringOrEmpty(parameters.plane);
  if (plane) parts.push(plane);
  const mateType = stringOrEmpty(parameters.mateType);
  if (mateType) parts.push(mateType);
  const name = stringOrEmpty(parameters.name);
  if (name) parts.push(name);
  const expression = stringOrEmpty(parameters.expression);
  if (operation === "set_variable" && expression) parts.push(expression);
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

export function parsePositiveCount(value: unknown, label: string): number | undefined {
  if (isEmptyMm(value)) return undefined;
  const parsed = parseBareNumber(value);
  if (parsed == null || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

export function requireComposerDimensions(
  operation: ComposerNativeOp,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  switch (operation) {
    case "create_sketch": {
      const kind = stringOrEmpty(parameters.sketchKind).toLowerCase();
      if (kind === "circle") {
        if (asFiniteNumber(parameters.radiusMm) == null) {
          throw new Error("Circle sketches need a positive radius in millimetres.");
        }
        break;
      }
      if (kind === "polyline") {
        const points = parseComposerSketchPoints(parameters.points);
        if (points.length < 2) {
          throw new Error("Polyline sketches need at least two millimetre points (xMm, yMm).");
        }
        parameters.points = points;
        break;
      }
      if (kind === "points") {
        const points = parseComposerSketchPoints(parameters.points);
        if (!points.length) {
          throw new Error("Point sketches need at least one millimetre point (xMm, yMm).");
        }
        parameters.points = points;
        break;
      }
      if (asFiniteNumber(parameters.widthMm) == null || asFiniteNumber(parameters.heightMm) == null) {
        throw new Error("Sketch width and height are required millimetres.");
      }
      break;
    }
    case "create_revolve": {
      if (parameters.angleDeg != null && parameters.angleDeg !== "") {
        const angle = Number(parameters.angleDeg);
        if (!Number.isFinite(angle) || angle <= 0 || angle > 360) {
          throw new Error("Revolve angle must be a positive number of degrees (max 360).");
        }
        parameters.angleDeg = angle;
      }
      break;
    }
    case "create_extrude":
      if (asFiniteNumber(parameters.depthMm) == null) {
        throw new Error("Extrude depth is required millimetres.");
      }
      break;
    case "create_fillet":
      if (asFiniteNumber(parameters.radiusMm) == null) {
        throw new Error("Fillet radius is required millimetres.");
      }
      break;
    case "create_chamfer":
      if (asFiniteNumber(parameters.widthMm) == null) {
        throw new Error("Chamfer width is required millimetres.");
      }
      break;
    case "create_shell":
      if (asFiniteNumber(parameters.thicknessMm) == null) {
        throw new Error("Shell thickness is required millimetres.");
      }
      break;
    case "create_hole":
      if (asFiniteNumber(parameters.diameterMm) == null) {
        throw new Error("Hole diameter is required millimetres.");
      }
      break;
    default:
      break;
  }
  return parameters;
}

/** Draft-path only. Empty stored plans must still parse — do not call from parseComposerOps. */
export function requireComposerPicks(
  operation: ComposerNativeOp,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  switch (operation) {
    case "create_fillet":
      if (!hasNonEmptyIds(parameters.entities) && !hasNonEmptyIds(parameters.edgeIds)) {
        throw new Error(
          "Fillet needs at least one edge id from list-onshape-entities (entities or edgeIds). Do not invent ids.",
        );
      }
      break;
    case "create_chamfer":
      if (!hasNonEmptyIds(parameters.entities) && !hasNonEmptyIds(parameters.edgeIds)) {
        throw new Error(
          "Chamfer needs at least one edge id from list-onshape-entities (entities or edgeIds). Do not invent ids.",
        );
      }
      break;
    case "create_shell":
      if (!hasNonEmptyIds(parameters.faceIds)) {
        throw new Error("Shell needs at least one face id to open from list-onshape-entities. Do not invent ids.");
      }
      break;
    case "create_hole":
      if (!hasNonEmptyIds(parameters.faceIds) || !hasNonEmptyIds(parameters.bodyIds)) {
        throw new Error(
          "Hole needs location face ids and scope body ids from list-onshape-entities. Do not invent ids.",
        );
      }
      break;
    case "create_pattern": {
      if (!hasNonEmptyIds(parameters.featureIds)) {
        throw new Error("Pattern needs feature ids from the Vantage feature tree. Do not invent ids.");
      }
      const circular =
        stringOrEmpty(parameters.patternKind) === "circular" || hasNonEmptyIds(parameters.axisIds);
      if (circular) {
        if (!hasNonEmptyIds(parameters.axisIds)) {
          throw new Error("Circular pattern needs axis ids from list-onshape-entities. Do not invent ids.");
        }
      } else if (asFiniteNumber(parameters.instanceCount) == null || asFiniteNumber(parameters.spacingMm) == null) {
        throw new Error("Linear pattern needs instance count and spacing in millimetres.");
      }
      break;
    }
    case "create_mirror":
      if (!hasNonEmptyIds(parameters.featureIds)) {
        throw new Error("Mirror needs feature ids from the Vantage feature tree. Do not invent ids.");
      }
      break;
    case "create_mate": {
      const mateType = canonicalMateType(parameters.mateType);
      if (!mateType) {
        throw new Error("Mate needs a type of FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL.");
      }
      parameters.mateType = mateType;
      if (
        !(hasNonEmptyId(parameters.firstInstanceId) || hasNonEmptyIds(parameters.firstInstanceId)) ||
        !(hasNonEmptyId(parameters.secondInstanceId) || hasNonEmptyIds(parameters.secondInstanceId))
      ) {
        throw new Error(
          "Mate needs first and second instance ids from list-onshape-assembly. Do not invent ids.",
        );
      }
      if (
        !(hasNonEmptyId(parameters.firstFaceId) || hasNonEmptyIds(parameters.firstFaceId)) ||
        !(hasNonEmptyId(parameters.secondFaceId) || hasNonEmptyIds(parameters.secondFaceId))
      ) {
        throw new Error(
          "Mate needs first and second face ids from list-onshape-entities. Do not invent ids.",
        );
      }
      break;
    }
    case "create_revolve":
      if (!hasNonEmptyIds(parameters.axisIds) && !hasNonEmptyIds(parameters.entities)) {
        throw new Error("Revolve needs at least one axis id from list-onshape-entities. Do not invent ids.");
      }
      break;
    case "create_boolean": {
      const kind = stringOrEmpty(parameters.operationType).toUpperCase();
      if (kind !== "UNION" && kind !== "SUBTRACT" && kind !== "INTERSECT") {
        throw new Error("Boolean needs operationType UNION, SUBTRACT, or INTERSECT.");
      }
      parameters.operationType = kind;
      if (!hasNonEmptyIds(parameters.toolBodyIds) && !hasNonEmptyIds(parameters.bodyIds)) {
        throw new Error("Boolean needs tool body ids from list-onshape-entities. Do not invent ids.");
      }
      if (
        (kind === "SUBTRACT" || kind === "INTERSECT") &&
        !hasNonEmptyIds(parameters.targetBodyIds)
      ) {
        throw new Error("Subtract and intersect need target body ids from list-onshape-entities. Do not invent ids.");
      }
      break;
    }
    case "delete_feature":
      if (!hasNonEmptyId(parameters.featureId) && !hasNonEmptyIds(parameters.featureId)) {
        throw new Error("Delete feature needs a feature id from the Vantage feature tree. Do not invent ids.");
      }
      break;
    default:
      break;
  }
  return parameters;
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
      else if (
        operation === "create_sketch" &&
        field.key === "closed" &&
        String(parameters.sketchKind ?? draft.sketchKind ?? "").toLowerCase() === "polyline"
      ) {
        parameters.closed = false;
      }
      continue;
    }
    const text = raw == null ? "" : String(raw);
    if (field.kind === "mm") {
      const parsed = parsePositiveMm(text, field.label);
      if (parsed != null) parameters[field.key] = parsed;
      continue;
    }
    if (field.kind === "count") {
      const parsed = parsePositiveCount(text, field.label);
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
      if (list) {
        if (operation === "delete_feature" && field.key === "featureId") {
          for (const id of list) refuseDemoFeatureId(id);
        }
        parameters[field.key] = list;
      }
      continue;
    }
    if (operation === "set_variable" && (field.key === "name" || field.key === "expression")) {
      const parsed = refuseDemoVariableText(text, field.key);
      if (parsed) parameters[field.key] = parsed;
      continue;
    }
    if (operation === "set_variable" && field.key === "variableStudioElementId") {
      const parsed = refuseDemoVariableStudioId(text);
      if (parsed) parameters[field.key] = parsed;
      continue;
    }
    if (operation === "delete_feature" && field.key === "featureId") {
      const parsed = refuseDemoFeatureId(text);
      if (parsed) parameters[field.key] = parsed;
      continue;
    }
    if (text.trim()) parameters[field.key] = text.trim();
  }
  return requireComposerPicks(operation, requireComposerDimensions(operation, parameters));
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
      if (field.key === "points") {
        draft[field.key] = formatComposerSketchPoints(value);
        continue;
      }
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
    const canonical = POSITIVE_MM_ALIASES[key] ?? COUNT_ALIASES[key] ?? LIST_ALIASES[key] ?? key;
    if (aliased[canonical] === undefined) aliased[canonical] = value;
  }
  if (operation === "create_shell") {
    if (aliased.faceIds === undefined) {
      if (aliased.entities !== undefined) aliased.faceIds = aliased.entities;
      else if (aliased.faces !== undefined) aliased.faceIds = aliased.faces;
    }
    delete aliased.entities;
    delete aliased.faces;
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
    if (COUNT_BY_OP[operation].includes(key)) {
      const parsed = parsePositiveCount(value, countLabel(key));
      if (parsed != null) parameters[key] = parsed;
      continue;
    }
    if (SIGNED_MM_BY_OP[operation].includes(key)) {
      const parsed = parseSignedMm(value, mmLabel(key));
      if (parsed != null) parameters[key] = parsed;
      continue;
    }
    if (operation === "set_variable" && (key === "name" || key === "expression")) {
      const parsed = refuseDemoVariableText(value, key);
      if (parsed) parameters[key] = parsed;
      continue;
    }
    if (operation === "set_variable" && key === "variableStudioElementId") {
      const parsed = refuseDemoVariableStudioId(value);
      if (parsed) parameters[key] = parsed;
      continue;
    }
    if (operation === "delete_feature" && key === "featureId") {
      const parsed = refuseDemoFeatureId(value);
      if (parsed) parameters[key] = parsed;
      continue;
    }
    if (isEmptyMm(value)) continue;
    parameters[key] = value;
  }
  if (operation === "create_sketch" && parameters.points != null) {
    parameters.points = parseComposerSketchPoints(parameters.points);
  }
  if (operation === "create_revolve" && parameters.angleDeg != null && parameters.angleDeg !== "") {
    const angle = Number(parameters.angleDeg);
    if (!Number.isFinite(angle) || angle <= 0 || angle > 360) {
      throw new Error("Revolve angle must be a positive number of degrees (max 360).");
    }
    parameters.angleDeg = angle;
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

export function parseComposerSketchPoints(value: unknown): Array<{ xMm: number; yMm: number }> {
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error("Points JSON is invalid. Use millimetre pairs like 0,0; 80,0; 80,40.");
      }
      return parseComposerSketchPoints(parsed);
    }
    return trimmed
      .split(/[;|\n]+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk, index) => parseComposerSketchPoint(chunk, index));
  }
  if (!Array.isArray(value)) {
    throw new Error("Points must be millimetre pairs like 0,0; 80,0; 80,40.");
  }
  return value.map((item, index) => parseComposerSketchPoint(item, index));
}

function parseComposerSketchPoint(item: unknown, index: number): { xMm: number; yMm: number } {
  if (Array.isArray(item) && item.length >= 2) {
    return { xMm: finiteSketchMm(item[0], index, "xMm"), yMm: finiteSketchMm(item[1], index, "yMm") };
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    return {
      xMm: finiteSketchMm(record.xMm ?? record.x, index, "xMm"),
      yMm: finiteSketchMm(record.yMm ?? record.y, index, "yMm"),
    };
  }
  if (typeof item === "string") {
    const nums = item.trim().split(/[,\s]+/).filter(Boolean);
    if (nums.length < 2) throw new Error(`Point ${index + 1} needs xMm and yMm in millimetres.`);
    return { xMm: finiteSketchMm(nums[0], index, "xMm"), yMm: finiteSketchMm(nums[1], index, "yMm") };
  }
  throw new Error(`Point ${index + 1} needs xMm and yMm in millimetres.`);
}

function finiteSketchMm(value: unknown, index: number, axis: "xMm" | "yMm"): number {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 10_000) {
    throw new Error(`points[${index}].${axis} must be a number of millimetres between -10000 and 10000.`);
  }
  return number;
}

function formatComposerSketchPoints(value: unknown[]): string {
  return value
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const x = record.xMm ?? record.x;
        const y = record.yMm ?? record.y;
        if (x != null && y != null) return `${x},${y}`;
      }
      if (Array.isArray(item) && item.length >= 2) return `${item[0]},${item[1]}`;
      return String(item).trim();
    })
    .filter(Boolean)
    .join("; ");
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

function canonicalMateType(value: unknown): (typeof ALLOWED_MATE_TYPES)[number] | undefined {
  const text = stringOrEmpty(value).toUpperCase();
  return ALLOWED_MATE_TYPES.find((type) => type === text);
}

function hasNonEmptyIds(value: unknown): boolean {
  return Boolean(asStringArray(value)?.length);
}

function hasNonEmptyId(value: unknown): boolean {
  return typeof value === "string" && Boolean(value.trim());
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

const DEMO_VARIABLE = /demo/i;

function refuseDemoVariableText(value: unknown, kind: "name" | "expression"): string | undefined {
  if (isEmptyMm(value)) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (DEMO_VARIABLE.test(text)) {
    throw new Error(
      kind === "name"
        ? "Refusing DEMO variable name. Pass a real Onshape variable name."
        : 'Refusing DEMO variable value. Pass a real Onshape expression such as "25 mm".',
    );
  }
  return text;
}

function refuseDemoVariableStudioId(value: unknown): string | undefined {
  if (isEmptyMm(value)) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (DEMO_VARIABLE.test(text)) {
    throw new Error("Refusing DEMO Variable Studio id. Use an element Onshape listed.");
  }
  return text;
}

function refuseDemoFeatureId(value: unknown): string | undefined {
  if (isEmptyMm(value)) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (DEMO_VARIABLE.test(text)) {
    throw new Error("Refusing DEMO feature id. Pass a real feature id from the Vantage feature tree.");
  }
  return text;
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

function countLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
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
