/**
 * One catalog for every CAD tool Claude (terminal MCP) and the hosted web agent
 * can call, with the honest per-platform support answer.
 *
 * This is the single source of truth for:
 *  - the MCP tools/list schema (packages/cad/src/claude-cad.ts)
 *  - the hosted agent's allowlist + prompt (cad-agent-action.ts)
 *  - the /cad "Tools" panel, which shows "Onshape only" *before* the agent tries
 *    an operation the Fusion add-in cannot run
 *  - docs/CLAUDE_CODE_CAD.md
 *
 * `fusion` is deliberately conservative: "supported" means the VantageCadRelay
 * add-in in packages/fusion360-official-connector implements the operation today.
 * Anything else is "unsupported" and the UI says so rather than failing at
 * execution time.
 *
 * Every Fusion-supported tool names the relay operation it sends in
 * `fusionOperation`, and cad-tool-catalog.test.ts asserts that operation is in
 * FUSION_RELAY_IMPLEMENTED_OPERATIONS — so this file cannot drift into claiming
 * Fusion parity the add-in does not have. `fusionNote` also carries the *partial*
 * cases (Fusion fillets every edge, Onshape can fillet just the corners), which
 * the UI shows on supported tools as a caveat rather than hiding.
 */

export type CadPlatformSupport = "supported" | "unsupported";

export type CadToolParam = {
  name: string;
  type: "number" | "string" | "boolean" | "array";
  required?: boolean;
  description: string;
  /** JSON-schema `items` for array params. */
  items?: Record<string, unknown>;
};

export type CadToolSpec = {
  name: string;
  /** Short human label for the /cad tools panel. */
  label: string;
  group: "session" | "sketch" | "solid" | "modify" | "pattern" | "inspect";
  description: string;
  params: CadToolParam[];
  onshape: CadPlatformSupport;
  fusion: CadPlatformSupport;
  /**
   * The relay operation a `fusion: "supported"` tool sends. Cross-checked against
   * FUSION_RELAY_IMPLEMENTED_OPERATIONS by the catalog test, so a tool can never
   * be advertised as Fusion-capable unless the add-in really runs that operation.
   */
  fusionOperation?: string;
  /** Fusion-parity note shown in the UI when fusion === "unsupported". */
  fusionNote?: string;
  /** True when the tool changes geometry (used for sync + narration wording). */
  mutating: boolean;
};

const mm = (name: string, description: string, required = true): CadToolParam => ({
  name,
  type: "number",
  required,
  description,
});

export const CAD_TOOL_CATALOG: readonly CadToolSpec[] = [
  {
    name: "cad_status",
    label: "Status",
    group: "session",
    description: "Show whether Onshape API keys and the local Fusion add-in are ready, plus the bound Part Studio.",
    params: [],
    onshape: "supported",
    fusion: "supported",
    mutating: false,
  },
  {
    name: "cad_setup",
    label: "Setup help",
    group: "session",
    description: "Return short setup steps for Onshape API keys and the Fusion 360 local add-in.",
    params: [],
    onshape: "supported",
    fusion: "supported",
    mutating: false,
  },
  {
    name: "cad_tools",
    label: "Tool list",
    group: "session",
    description: "List every CAD operation with its Onshape / Fusion support, so nothing is attempted blind.",
    params: [],
    onshape: "supported",
    fusion: "supported",
    mutating: false,
  },
  {
    name: "onshape_list_documents",
    label: "List documents",
    group: "session",
    description: "List recent Onshape documents for the connected account.",
    params: [{ name: "limit", type: "number", description: "How many documents to return (1–40, default 12)." }],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion works on the design that is already open — there is no document list to browse.",
    mutating: false,
  },
  {
    name: "onshape_list_elements",
    label: "List Part Studios",
    group: "session",
    description: "List elements (Part Studios) in an Onshape document workspace.",
    params: [
      { name: "documentId", type: "string", required: true, description: "Onshape document id." },
      { name: "workspaceId", type: "string", required: true, description: "Onshape workspace id." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion works on the design that is already open.",
    mutating: false,
  },
  {
    name: "onshape_bind",
    label: "Bind Part Studio",
    group: "session",
    description: "Remember the Part Studio this session edits. Use a disposable document, never the competition robot.",
    params: [
      { name: "documentId", type: "string", required: true, description: "Onshape document id." },
      { name: "workspaceId", type: "string", required: true, description: "Onshape workspace id." },
      { name: "elementId", type: "string", required: true, description: "Part Studio element id." },
      { name: "documentName", type: "string", description: "Human name to show in the session log." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "The Fusion relay always targets the active design.",
    mutating: true,
  },
  {
    name: "onshape_describe",
    label: "Describe features",
    group: "inspect",
    description: "List the features in the bound Part Studio, newest last, with plain-English explanations.",
    params: [],
    onshape: "supported",
    fusion: "supported",
    fusionOperation: "verify_topology",
    mutating: false,
  },
  {
    name: "onshape_sketch_rectangle",
    label: "Sketch rectangle",
    group: "sketch",
    description: "Add a rectangle sketch on Front/Top/Right. Dimensions in millimetres.",
    params: [
      mm("widthMm", "Rectangle width in millimetres."),
      mm("heightMm", "Rectangle height in millimetres."),
      { name: "plane", type: "string", description: "Front, Top, or Right (default Top)." },
      { name: "originXMm", type: "number", description: "Corner X offset from the sketch origin in mm (default 0)." },
      { name: "originYMm", type: "number", description: "Corner Y offset from the sketch origin in mm (default 0)." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "supported",
    fusionOperation: "create_sketch",
    mutating: true,
  },
  {
    name: "onshape_sketch_circle",
    label: "Sketch circle",
    group: "sketch",
    description:
      "Add a sketch with one or more circles (extrudable regions — bosses, bores, standoffs). For fastener holes prefer onshape_hole.",
    params: [
      mm("diameterMm", "Circle diameter in millimetres (single-circle form).", false),
      { name: "centerXMm", type: "number", description: "Circle centre X in mm (default 0)." },
      { name: "centerYMm", type: "number", description: "Circle centre Y in mm (default 0)." },
      {
        name: "circles",
        type: "array",
        description: "Multiple circles: [{ diameterMm, centerXMm, centerYMm }]. Overrides the single-circle form.",
        items: {
          type: "object",
          properties: {
            diameterMm: { type: "number" },
            centerXMm: { type: "number" },
            centerYMm: { type: "number" },
          },
          required: ["diameterMm"],
        },
      },
      { name: "plane", type: "string", description: "Front, Top, or Right (default Top)." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "supported",
    fusionOperation: "create_sketch",
    fusionNote:
      "Fusion draws one circle per sketch (diameterMm + centre); the multi-circle `circles` array is Onshape only.",
    mutating: true,
  },
  {
    name: "onshape_sketch_polyline",
    label: "Sketch polyline",
    group: "sketch",
    description:
      "Add a sketch from explicit mm points — open path or closed polygon (gussets, bellypan outlines, non-rectangular plates).",
    params: [
      {
        name: "points",
        type: "array",
        required: true,
        description: "Ordered points [{ xMm, yMm }], 2–128 of them.",
        items: {
          type: "object",
          properties: { xMm: { type: "number" }, yMm: { type: "number" } },
          required: ["xMm", "yMm"],
        },
      },
      { name: "closed", type: "boolean", description: "Close the loop so the region can be extruded (default true)." },
      { name: "plane", type: "string", description: "Front, Top, or Right (default Top)." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "The Fusion add-in sketches rectangles and circles only.",
    mutating: true,
  },
  {
    name: "onshape_sketch_points",
    label: "Sketch hole points",
    group: "sketch",
    description: "Add a sketch of bare points. These are the drill locations onshape_hole consumes.",
    params: [
      {
        name: "points",
        type: "array",
        description: "Explicit points [{ xMm, yMm }].",
        items: {
          type: "object",
          properties: { xMm: { type: "number" }, yMm: { type: "number" } },
          required: ["xMm", "yMm"],
        },
      },
      { name: "gridCountX", type: "number", description: "Grid helper: number of columns." },
      { name: "gridCountY", type: "number", description: "Grid helper: number of rows (default 1)." },
      { name: "gridPitchXMm", type: "number", description: "Grid helper: column spacing in mm." },
      { name: "gridPitchYMm", type: "number", description: "Grid helper: row spacing in mm." },
      { name: "originXMm", type: "number", description: "Grid helper: first point X in mm (default 0)." },
      { name: "originYMm", type: "number", description: "Grid helper: first point Y in mm (default 0)." },
      { name: "plane", type: "string", description: "Front, Top, or Right (default Top)." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Hole points are part of the Onshape hole workflow; the Fusion add-in has no hole tool yet.",
    mutating: true,
  },
  {
    name: "onshape_extrude",
    label: "Extrude",
    group: "solid",
    description: "Extrude a sketch region. NEW makes a body, REMOVE cuts, ADD merges. Depth in millimetres.",
    params: [
      mm("depthMm", "Extrude depth in millimetres."),
      { name: "sketchFeatureId", type: "string", description: "Sketch to extrude (defaults to the last sketch this session)." },
      { name: "operationType", type: "string", description: "NEW, ADD, REMOVE, or INTERSECT (default NEW)." },
      { name: "oppositeDirection", type: "boolean", description: "Flip the extrude direction." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "supported",
    fusionOperation: "create_extrude",
    mutating: true,
  },
  {
    name: "onshape_fillet",
    label: "Fillet",
    group: "modify",
    description:
      "Round edges. selection='corners' fillets only the corner edges of the extruded plate; 'all' rounds every edge the feature made.",
    params: [
      mm("radiusMm", "Fillet radius in millimetres."),
      { name: "featureId", type: "string", description: "Feature whose edges to round (defaults to the last solid feature)." },
      { name: "selection", type: "string", description: "'corners' (default) or 'all'." },
      { name: "plane", type: "string", description: "Sketch plane the solid was built on, used to find corner edges (default Top)." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "supported",
    fusionOperation: "create_fillet",
    fusionNote:
      "Fusion rounds every edge of the most recent body — the corners-only selection is Onshape only.",
    mutating: true,
  },
  {
    name: "onshape_chamfer",
    label: "Chamfer",
    group: "modify",
    description: "Bevel edges by an equal-offset width in millimetres.",
    params: [
      mm("widthMm", "Chamfer leg length in millimetres."),
      { name: "featureId", type: "string", description: "Feature whose edges to bevel (defaults to the last solid feature)." },
      { name: "selection", type: "string", description: "'corners' (default) or 'all'." },
      { name: "plane", type: "string", description: "Sketch plane the solid was built on (default Top)." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "supported",
    fusionOperation: "create_chamfer",
    fusionNote:
      "Fusion bevels every edge of the most recent body — the corners-only selection is Onshape only.",
    mutating: true,
  },
  {
    name: "onshape_hole",
    label: "Hole",
    group: "modify",
    description:
      "Drill a real Hole feature at the points of a point sketch. THROUGH by default; BLIND needs depthMm. Never exceeds the stock it drills.",
    params: [
      mm("diameterMm", "Hole diameter in millimetres."),
      {
        name: "pointSketchFeatureId",
        type: "string",
        description: "Point sketch holding the drill locations (defaults to the last point sketch this session).",
      },
      { name: "endStyle", type: "string", description: "THROUGH (default) or BLIND." },
      { name: "depthMm", type: "number", description: "Depth in mm — required for BLIND." },
      { name: "targetFeatureId", type: "string", description: "Feature whose bodies to drill (defaults to every solid body)." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "The Fusion add-in has no hole tool yet — cut circles with a sketch + extrude REMOVE instead.",
    mutating: true,
  },
  {
    name: "onshape_linear_pattern",
    label: "Linear pattern",
    group: "pattern",
    description: "Repeat whole features along a straight edge — bolt rows, rib arrays.",
    params: [
      mm("spacingMm", "Distance between instances in millimetres."),
      { name: "instanceCount", type: "number", required: true, description: "Total instances including the original (2–200)." },
      { name: "featureIds", type: "array", description: "Features to repeat (defaults to the last feature).", items: { type: "string" } },
      {
        name: "direction",
        type: "string",
        description: "World axis the pattern runs along: X (default), Y, or Z. X and Y lie in a Top-plane sketch.",
      },
      { name: "oppositeDirection", type: "boolean", description: "Run the pattern the other way." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Pattern features are Onshape-only in Vantage today.",
    mutating: true,
  },
  {
    name: "onshape_circular_pattern",
    label: "Circular pattern",
    group: "pattern",
    description: "Repeat whole features around a cylindrical face (a bore or a drilled hole) — spoke and bolt-circle patterns.",
    params: [
      { name: "instanceCount", type: "number", required: true, description: "Total instances including the original (2–200)." },
      { name: "axisFeatureId", type: "string", required: true, description: "Feature with the cylindrical face to rotate about." },
      { name: "featureIds", type: "array", description: "Features to repeat (defaults to the last feature).", items: { type: "string" } },
      { name: "angleDeg", type: "number", description: "Sweep angle in degrees (default 360)." },
      { name: "equalSpacing", type: "boolean", description: "Space instances evenly over the angle (default true)." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Pattern features are Onshape-only in Vantage today.",
    mutating: true,
  },
  {
    name: "onshape_mirror",
    label: "Mirror",
    group: "pattern",
    description: "Mirror whole features across a standard plane — keeps left/right subassemblies symmetric.",
    params: [
      { name: "plane", type: "string", description: "Front, Top, or Right (default Right)." },
      { name: "featureIds", type: "array", description: "Features to mirror (defaults to the last feature).", items: { type: "string" } },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Mirror is Onshape-only in Vantage today.",
    mutating: true,
  },
  {
    name: "onshape_delete_feature",
    label: "Undo feature",
    group: "modify",
    description:
      "Delete a feature this session created (agent undo). It refuses to touch features it did not add, so hand-built history is safe.",
    params: [
      { name: "featureId", type: "string", description: "Feature to delete (defaults to the most recent feature this session added)." },
    ],
    onshape: "supported",
    fusion: "supported",
    fusionOperation: "delete_feature",
    fusionNote:
      "Fusion undoes the last feature the relay created in the running add-in session (tokens reset when the add-in restarts).",
    mutating: true,
  },
  {
    name: "fusion_status",
    label: "Fusion status",
    group: "session",
    description: "Ping the local Fusion VantageCadRelay add-in on loopback.",
    params: [],
    onshape: "unsupported",
    fusion: "supported",
    mutating: false,
  },
  {
    name: "fusion_describe",
    label: "Fusion describe",
    group: "inspect",
    description: "Verify the open Fusion design (body/feature counts).",
    params: [],
    onshape: "unsupported",
    fusion: "supported",
    fusionOperation: "verify_topology",
    mutating: false,
  },
  {
    name: "fusion_sketch_rectangle",
    label: "Fusion rectangle",
    group: "sketch",
    description: "Create a rectangle sketch in the active Fusion design. Dimensions in millimetres.",
    params: [
      mm("widthMm", "Rectangle width in millimetres."),
      mm("heightMm", "Rectangle height in millimetres."),
      { name: "name", type: "string", description: "Sketch name." },
    ],
    onshape: "unsupported",
    fusion: "supported",
    fusionOperation: "create_sketch",
    mutating: true,
  },
  {
    name: "fusion_sketch_circle",
    label: "Fusion circle",
    group: "sketch",
    description: "Create a circle sketch in the active Fusion design. Diameter in millimetres.",
    params: [
      mm("diameterMm", "Circle diameter in millimetres."),
      { name: "centerXMm", type: "number", description: "Centre X in mm (default 0)." },
      { name: "centerYMm", type: "number", description: "Centre Y in mm (default 0)." },
      { name: "name", type: "string", description: "Sketch name." },
    ],
    onshape: "unsupported",
    fusion: "supported",
    fusionOperation: "create_sketch",
    mutating: true,
  },
  {
    name: "fusion_extrude",
    label: "Fusion extrude",
    group: "solid",
    description: "Extrude the latest Fusion sketch. Depth in millimetres.",
    params: [mm("depthMm", "Extrude depth in millimetres.")],
    onshape: "unsupported",
    fusion: "supported",
    fusionOperation: "create_extrude",
    mutating: true,
  },
  {
    name: "fusion_fillet",
    label: "Fusion fillet",
    group: "modify",
    description: "Round every edge of the most recent Fusion body. Radius in millimetres.",
    params: [mm("radiusMm", "Fillet radius in millimetres.")],
    onshape: "unsupported",
    fusion: "supported",
    fusionOperation: "create_fillet",
    fusionNote:
      "Rounds every edge of the most recent body — there is no corners-only selection in the relay.",
    mutating: true,
  },
  {
    name: "fusion_chamfer",
    label: "Fusion chamfer",
    group: "modify",
    description: "Bevel every edge of the most recent Fusion body. Distance in millimetres.",
    params: [mm("widthMm", "Chamfer distance in millimetres.")],
    onshape: "unsupported",
    fusion: "supported",
    fusionOperation: "create_chamfer",
    fusionNote:
      "Bevels every edge of the most recent body — there is no corners-only selection in the relay.",
    mutating: true,
  },
  {
    name: "fusion_undo_last",
    label: "Fusion undo",
    group: "modify",
    description: "Delete the most recent feature the relay created in the active Fusion design.",
    params: [],
    onshape: "unsupported",
    fusion: "supported",
    fusionOperation: "delete_feature",
    fusionNote:
      "Only undoes features the relay itself created, and only while the add-in stays running.",
    mutating: true,
  },
] as const;

export function cadToolSpec(name: string): CadToolSpec | undefined {
  return CAD_TOOL_CATALOG.find((tool) => tool.name === name);
}

/** Tools the hosted (Onshape-only, no loopback) web agent may call. */
export function hostedCadToolNames(): string[] {
  return CAD_TOOL_CATALOG.filter((tool) => tool.onshape === "supported").map((tool) => tool.name);
}

export function mutatingCadToolNames(): string[] {
  return CAD_TOOL_CATALOG.filter((tool) => tool.mutating).map((tool) => tool.name);
}

/** JSON-schema `inputSchema` for MCP tools/list, generated from the catalog. */
export function cadToolInputSchema(tool: CadToolSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of tool.params) {
    properties[param.name] =
      param.type === "array"
        ? { type: "array", description: param.description, items: param.items ?? {} }
        : { type: param.type, description: param.description };
    if (param.required) required.push(param.name);
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

/** Compact per-platform matrix for the /cad tools panel and the docs table. */
export function cadToolSupportMatrix() {
  return CAD_TOOL_CATALOG.map((tool) => ({
    name: tool.name,
    label: tool.label,
    group: tool.group,
    description: tool.description,
    onshape: tool.onshape,
    fusion: tool.fusion,
    fusionOperation: tool.fusionOperation ?? null,
    fusionNote: tool.fusionNote ?? null,
    mutating: tool.mutating,
  }));
}
