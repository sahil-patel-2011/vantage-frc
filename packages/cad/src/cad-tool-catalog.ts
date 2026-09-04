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
  group: "session" | "sketch" | "solid" | "modify" | "pattern" | "assembly" | "inspect";
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
    name: "onshape_create_part_studio",
    label: "Create Part Studio",
    group: "session",
    description:
      "Create and bind a real Part Studio with the native Onshape element API. No FeatureScript.",
    params: [
      { name: "documentId", type: "string", description: "Document id; defaults to the bound document." },
      { name: "workspaceId", type: "string", description: "Workspace id; defaults to the bound workspace." },
      { name: "name", type: "string", required: true, description: "Name for the new Part Studio." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion creates components in the active design rather than cloud Part Studio elements.",
    mutating: true,
  },
  {
    name: "onshape_body_details",
    label: "Part faces",
    group: "inspect",
    description:
      "Read native Part Studio body details, including part and face deterministic ids for manual assembly mating. No FeatureScript.",
    params: [],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion inspection is provided by fusion_describe.",
    mutating: false,
  },
  {
    name: "onshape_create_assembly",
    label: "Create assembly",
    group: "assembly",
    description: "Create a real Onshape Assembly element in the bound document/workspace.",
    params: [
      { name: "documentId", type: "string", description: "Document id; defaults to the bound document." },
      { name: "workspaceId", type: "string", description: "Workspace id; defaults to the bound workspace." },
      { name: "name", type: "string", required: true, description: "Assembly name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion assemblies use components/joints in the active local design.",
    mutating: true,
  },
  {
    name: "onshape_add_assembly_instance",
    label: "Insert part",
    group: "assembly",
    description:
      "Insert a part, whole Part Studio, or sub-assembly using Onshape's native Assembly API.",
    params: [
      { name: "assemblyElementId", type: "string", description: "Assembly id; defaults to the last created assembly." },
      { name: "sourceDocumentId", type: "string", description: "Source document; defaults to the bound document." },
      { name: "sourceElementId", type: "string", description: "Part Studio/Assembly id; defaults to the bound Part Studio." },
      { name: "partId", type: "string", description: "Specific part id from onshape_body_details; omit for the whole Part Studio." },
      { name: "isAssembly", type: "boolean", description: "Insert sourceElementId as a sub-assembly." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion assemblies use components/joints in the active local design.",
    mutating: true,
  },
  {
    name: "onshape_mate",
    label: "Mate instances",
    group: "assembly",
    description:
      "Create native face-centred mate connectors and a FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL mate. No FeatureScript.",
    params: [
      { name: "assemblyElementId", type: "string", description: "Assembly id; defaults to the last created assembly." },
      { name: "name", type: "string", description: "Mate name." },
      { name: "mateType", type: "string", required: true, description: "FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL." },
      { name: "firstInstanceId", type: "string", required: true, description: "First instance id." },
      { name: "secondInstanceId", type: "string", required: true, description: "Second instance id." },
      { name: "firstFaceId", type: "string", required: true, description: "Face id on the first part from onshape_body_details." },
      { name: "secondFaceId", type: "string", required: true, description: "Face id on the second part from onshape_body_details." },
      { name: "firstFlipPrimary", type: "boolean", description: "Flip connector A's normal." },
      { name: "secondFlipPrimary", type: "boolean", description: "Flip connector B's normal." },
      { name: "firstOffsetXMm", type: "number", description: "Connector A local X offset in mm." },
      { name: "firstOffsetYMm", type: "number", description: "Connector A local Y offset in mm." },
      { name: "firstOffsetZMm", type: "number", description: "Connector A normal offset in mm." },
      { name: "secondOffsetXMm", type: "number", description: "Connector B local X offset in mm." },
      { name: "secondOffsetYMm", type: "number", description: "Connector B local Y offset in mm." },
      { name: "secondOffsetZMm", type: "number", description: "Connector B normal offset in mm." },
      { name: "minLimit", type: "number", description: "Travel mm, or degrees for REVOLUTE." },
      { name: "maxLimit", type: "number", description: "Travel mm, or degrees for REVOLUTE." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion uses joints; this Onshape mate payload is not sent to the Fusion relay.",
    mutating: true,
  },
  {
    name: "onshape_get_assembly",
    label: "Inspect assembly",
    group: "assembly",
    description: "Read native assembly instances, occurrences, and mate features for verification.",
    params: [
      { name: "assemblyElementId", type: "string", description: "Assembly id; defaults to the last created assembly." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Use fusion_describe for the active Fusion design.",
    mutating: false,
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
    name: "onshape_revolve",
    label: "Revolve",
    group: "solid",
    description:
      "Turn a sketch profile about a centreline — rollers, shafts, and spacers. The axis is a straight line from a sketch, so the result is an ordinary Revolve a human can re-open and re-dimension.",
    params: [
      {
        name: "axisSketchFeatureId",
        type: "string",
        required: true,
        description:
          "Sketch holding the centreline to turn about. Use a sketch with exactly one line — Vantage will not pick between several.",
      },
      {
        name: "sketchFeatureId",
        type: "string",
        description: "Profile sketch to revolve (defaults to the last sketch this session).",
      },
      { name: "angleDeg", type: "number", description: "Sweep angle in degrees (default 360)." },
      { name: "operationType", type: "string", description: "NEW, ADD, REMOVE, or INTERSECT (default NEW)." },
      { name: "oppositeDirection", type: "boolean", description: "Turn the other way." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Revolve is Onshape-only in Vantage today.",
    mutating: true,
  },
  {
    name: "onshape_boolean",
    label: "Boolean",
    group: "solid",
    description:
      "Combine, subtract, or intersect whole bodies from two features — the way a pocket or a welded bracket is built without a cut sketch.",
    params: [
      {
        name: "operationType",
        type: "string",
        required: true,
        description: "UNION, SUBTRACT, or INTERSECT.",
      },
      {
        name: "toolFeatureId",
        type: "string",
        required: true,
        description: "Feature whose bodies act on the target (the subtracted body, for SUBTRACT).",
      },
      {
        name: "targetFeatureId",
        type: "string",
        description: "Feature whose bodies are kept and modified. Required for SUBTRACT and INTERSECT.",
      },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Boolean is Onshape-only in Vantage today.",
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
    name: "onshape_shell",
    label: "Shell",
    group: "modify",
    description:
      "Hollow a solid to a wall thickness, opening the face you name. Thickness goes inward, so the part keeps its outside size.",
    params: [
      mm("thicknessMm", "Wall thickness in millimetres."),
      {
        name: "openFace",
        type: "string",
        description:
          "Which face to remove, by the world direction it points: +Z (default, the top), -Z, +X, -X, +Y, or -Y.",
      },
      { name: "featureId", type: "string", description: "Feature to hollow (defaults to the last solid feature)." },
      { name: "outward", type: "boolean", description: "Thicken outward instead of inward." },
      { name: "name", type: "string", description: "Feature name." },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Shell is Onshape-only in Vantage today.",
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
    name: "onshape_variable_list",
    label: "List variables",
    group: "inspect",
    description:
      "Read the Variable Studio for this document — the named dimensions a human edits to resize the design.",
    params: [
      {
        name: "elementId",
        type: "string",
        description: "Variable Studio to read (defaults to the first one in the document).",
      },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion parameters are not exposed through the relay today.",
    mutating: false,
  },
  {
    name: "onshape_variable_set",
    label: "Set variable",
    group: "modify",
    description:
      "Create or update a named variable such as `wallThickness = 3 mm`. This is the most re-editable thing the agent can leave behind: a human changes the number and the model rebuilds.",
    params: [
      { name: "name", type: "string", required: true, description: "Variable name, e.g. wallThickness." },
      {
        name: "value",
        type: "string",
        required: true,
        description: 'Expression with units, e.g. "3 mm", "15 deg", or a plain number.',
      },
      { name: "description", type: "string", description: "What the variable is for." },
      {
        name: "elementId",
        type: "string",
        description: "Variable Studio to write to (defaults to the first one in the document).",
      },
    ],
    onshape: "supported",
    fusion: "unsupported",
    fusionNote: "Fusion parameters are not exposed through the relay today.",
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

// ---------------------------------------------------------------------------
// The part pipeline: local checks first, then ONE FeatureScript feature
// ---------------------------------------------------------------------------

/**
 * A second catalog, deliberately not more rows in CAD_TOOL_CATALOG.
 *
 * NOTE: this pipeline ships DISABLED. `cad_part_push` is gated behind
 * `featureScriptPartsEnabled()` in mcp-stdio.ts because it builds the part as one
 * generated FeatureScript custom feature, which a human cannot open, re-sketch, or
 * insert a feature into. The native tools in CAD_TOOL_CATALOG above now cover
 * revolve, boolean, shell and variables as well, so nothing forces a part through
 * here. The catalog stays because the tools still work — and are still tested —
 * for a deployment that sets VANTAGE_CAD_ALLOW_FEATURESCRIPT=1 knowingly.
 *
 * The tools above are one-REST-call-per-operation primitives, and
 * `hostedCadToolNames()` feeds the hosted /cad agent's allowlist straight from
 * that array. The pipeline below is dispatched by `mcp-stdio.ts` against the
 * terminal's own auth + on-disk session, not by `claude-cad.ts`, so listing it
 * in the same array would advertise tools the hosted agent cannot execute.
 *
 * The pipeline exists because Onshape's API allowance is ANNUAL and small
 * (2,500-10,000 calls/year depending on plan,
 * https://onshape-public.github.io/docs/auth/limits/, verified 2026-08-25), and a
 * naive sketch -> extrude -> describe -> render loop spends one call per
 * operation. Two facts shape every tool here:
 *
 *  1. Calls made with a signed-in browser session are NOT counted against that
 *     allowance (same page). `vantage-cad login` is what puts one on disk.
 *  2. One FeatureScript custom feature builds the whole solid, so the cost of a
 *     part does not grow with its hole count.
 *
 * `needs` is the canonical order, declared as data. `mcp-stdio.ts` enforces it
 * at runtime and names the tool that supplies whatever is missing, so an agent
 * cannot spend calls by pushing something it never checked.
 */

/** State a tool requires before it will spend anything. */
export type CadPartToolPrecondition = "auth" | "binding" | "check" | "preview" | "push";

export type CadPartToolStage = "auth" | "document" | "inspect" | "local" | "build" | "verify";

export type CadPartToolSpec = {
  name: string;
  /** Short human label for a status line or a docs table. */
  label: string;
  stage: CadPartToolStage;
  /** What a coding agent reads to decide whether to call this. Says the call cost out loud. */
  description: string;
  needs: readonly CadPartToolPrecondition[];
  /**
   * Onshape calls one successful run spends. Both bounds are real paths through
   * the tool, not padding — the per-tool comment says what moves it.
   */
  onshapeCalls: { min: number; max: number };
  /** True when the tool changes the Onshape document. */
  mutating: boolean;
  /** Full JSON Schema for tools/list. Hand-written: the part definition nests too deep for a param list. */
  inputSchema: Record<string, unknown>;
};

const numberField = (description: string) => ({ type: "number" as const, description });
const stringField = (description: string) => ({ type: "string" as const, description });
const boolField = (description: string) => ({ type: "boolean" as const, description });

const POINT_2MM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { xMm: numberField("X in mm."), yMm: numberField("Y in mm.") },
  required: ["xMm", "yMm"],
} as const;

/**
 * Hole placement. One `kind` selects which of the other fields are read; the
 * generator rejects a pattern whose fields do not match its kind rather than
 * filling one in.
 */
const HOLE_PATTERN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description:
    "Where the holes go. grid/corners/linear/circular stay editable as parameters later; explicit point lists are baked into the FeatureScript source and can only be changed by a rebuild.",
  properties: {
    kind: {
      type: "string",
      enum: ["grid", "corners", "linear", "circular", "explicit"],
      description:
        "grid: countX x countY on pitchXMm/pitchYMm, centred on the part origin. corners: the four footprint corners, inset insetXMm/insetYMm from each edge (plate or box only). linear: count points stepping from startXMm/startYMm by stepXMm/stepYMm. circular: count points on a bolt circle. explicit: literal points.",
    },
    countX: numberField("grid: columns."),
    countY: numberField("grid: rows."),
    pitchXMm: numberField("grid: column spacing in mm."),
    pitchYMm: numberField("grid: row spacing in mm."),
    insetXMm: numberField("corners: distance from each X edge to the hole centre, in mm."),
    insetYMm: numberField("corners: distance from each Y edge to the hole centre, in mm."),
    count: numberField("linear/circular: number of holes."),
    startXMm: numberField("linear: first hole centre X in mm."),
    startYMm: numberField("linear: first hole centre Y in mm."),
    stepXMm: numberField("linear: X step between holes in mm."),
    stepYMm: numberField("linear: Y step between holes in mm."),
    centerXMm: numberField("circular: bolt-circle centre X in mm."),
    centerYMm: numberField("circular: bolt-circle centre Y in mm."),
    boltCircleDiameterMm: numberField("circular: bolt-circle diameter in mm."),
    startAngleDeg: numberField("circular: angle of the first hole, measured from +X toward +Y (default 0)."),
    points: {
      type: "array",
      description: "explicit: the hole centres, in mm, in the part frame.",
      items: POINT_2MM_SCHEMA,
    },
  },
  required: ["kind"],
} as const;

/**
 * `thread` + `holeType` is the form that keeps a hole checkable: it names the
 * INTENT, and the diameter is then looked up (ISO 273 clearance, major-minus-
 * pitch tap drill, or the heat-set insert's installation hole) rather than
 * typed in. A bare `diameterMm` is accepted but the tool cannot then tell a
 * bolt clearance hole from a tapped one, so it cannot check the fit.
 */
const HOLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stringField("Stable token for this hole group, e.g. \"m3Corner\". Becomes the FeatureScript parameter prefix."),
    diameterMm: numberField(
      "Nominal diameter in mm — the size the PRINTED hole should end up. Omit it when thread + holeType are given. Never pre-compensate here; cad_part_check does that.",
    ),
    thread: {
      type: "string",
      enum: ["M2", "M2.5", "M3", "M4", "M5", "M6", "M8"],
      description: "Fastener size the hole is for. With holeType this replaces diameterMm.",
    },
    holeType: {
      type: "string",
      enum: ["clearance", "tapped", "heat-set"],
      description:
        "clearance: a bolt passes through (ISO 273). tapped: a thread is cut into the plastic (tap drill = major diameter - pitch). heat-set: a brass insert is melted in (the insert's installation-hole diameter). These are three different diameters for the same M3, so the tool asks rather than picking one.",
    },
    fit: {
      type: "string",
      enum: ["close", "normal", "loose"],
      description: "Clearance series for holeType=clearance. Defaults to ISO 273 normal (M3 -> 3.4 mm) and the result says so.",
    },
    insert: stringField(
      "Heat-set insert id for holeType=heat-set, e.g. \"M3x5.7\". Defaults to the longest tabulated body in that thread size, and the result says which.",
    ),
    through: boolField("True (default) cuts all the way through. False needs depthMm."),
    depthMm: numberField("Blind-hole depth in mm, measured down from the top face."),
    counterbore: {
      type: "object",
      additionalProperties: false,
      description: "Optional counterbore for a socket-head cap screw.",
      properties: {
        diameterMm: numberField("Counterbore diameter in mm."),
        depthMm: numberField("Counterbore depth in mm, from the top face."),
      },
      required: ["diameterMm", "depthMm"],
    },
    pattern: HOLE_PATTERN_SCHEMA,
  },
  required: ["id", "pattern"],
} as const;

/**
 * The buildable part. Origin is the CENTRE of the base footprint, +Z is up, the
 * base sits on Z = 0 — every coordinate below is in that frame, in millimetres.
 */
const PART_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description:
    "One printable part. Origin is the centre of the base footprint, +Z is up, the base sits on Z = 0. All dimensions in mm.",
  properties: {
    name: stringField("Part name. Becomes the Onshape feature name, so make it recognisable in the feature tree."),
    base: {
      type: "object",
      additionalProperties: false,
      description: "The starting solid. `kind` selects which fields are read.",
      properties: {
        kind: {
          type: "string",
          enum: ["plate", "box", "bracket"],
          description:
            "plate: widthMm x depthMm x thicknessMm flat stock. box: widthMm x depthMm x heightMm, hollowed when wallMm is given. bracket: an L — a flat leg legAMm long in +Y and an upright legBMm tall in +Z, both thicknessMm thick and widthMm wide.",
        },
        widthMm: numberField("X size in mm (all kinds)."),
        depthMm: numberField("Y size in mm (plate, box)."),
        thicknessMm: numberField("Z thickness in mm (plate), or wall thickness of both legs (bracket)."),
        heightMm: numberField("Z height in mm (box)."),
        wallMm: numberField("box: side wall thickness in mm. Omit for a solid block."),
        floorMm: numberField("box: floor thickness in mm (defaults to wallMm)."),
        openTop: boolField("box: leave the +Z face open (default true)."),
        legAMm: numberField("bracket: length of the flat leg in +Y, in mm."),
        legBMm: numberField("bracket: height of the upright leg in +Z, in mm."),
      },
      required: ["kind"],
    },
    holes: { type: "array", description: "Hole groups. One group covers every hole in its pattern.", items: HOLE_SCHEMA },
    pockets: {
      type: "array",
      description: "Rectangular pockets cut down from the top face.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: stringField("Stable token for this pocket."),
          centerXMm: numberField("Pocket centre X in mm."),
          centerYMm: numberField("Pocket centre Y in mm."),
          widthMm: numberField("Pocket X size in mm."),
          depthMm: numberField("Pocket Y size in mm (this is a footprint size, not how deep it cuts)."),
          cutDepthMm: numberField("How far down from the top face the pocket is cut, in mm."),
          cornerRadiusMm: numberField("Vertical corner radius in mm. Optional."),
        },
        required: ["id", "centerXMm", "centerYMm", "widthMm", "depthMm", "cutDepthMm"],
      },
    },
    ribs: {
      type: "array",
      description: "Axis-aligned stiffening ribs standing on the top face. Diagonal ribs are rejected, not approximated.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: stringField("Stable token for this rib."),
          fromXMm: numberField("Rib start X in mm."),
          fromYMm: numberField("Rib start Y in mm."),
          toXMm: numberField("Rib end X in mm. Either X or Y must match the start."),
          toYMm: numberField("Rib end Y in mm."),
          thicknessMm: numberField("Rib thickness in mm."),
          heightMm: numberField("Rib height above the top face in mm."),
        },
        required: ["id", "fromXMm", "fromYMm", "toXMm", "toYMm", "thicknessMm", "heightMm"],
      },
    },
    bosses: {
      type: "array",
      description:
        "Heat-set insert bosses: a cylinder on the top face with the insert bore drilled into it. Model an insert as a boss rather than a hole — the bore-depth and boss-wall rules only apply here.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: stringField("Stable token for this boss."),
          centerXMm: numberField("Boss centre X in mm."),
          centerYMm: numberField("Boss centre Y in mm."),
          outerDiameterMm: numberField("Boss outer diameter in mm."),
          heightMm: numberField("Boss height above the top face in mm."),
          insertDiameterMm: numberField("Insert bore diameter in mm — the insert's installation hole, from its datasheet."),
          insertDepthMm: numberField("Bore depth in mm."),
        },
        required: ["id", "centerXMm", "centerYMm", "outerDiameterMm", "heightMm", "insertDiameterMm", "insertDepthMm"],
      },
    },
    edges: {
      type: "array",
      description: "Fillets and chamfers applied to the finished body.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: stringField("Stable token for this edge treatment."),
          kind: { type: "string", enum: ["fillet", "chamfer"], description: "Round or bevel." },
          selection: {
            type: "string",
            enum: ["corners", "all"],
            description:
              "corners: the vertical (Z-parallel) corner edges only. all: every edge of the body — note this reaches the bottom perimeter, which prints as an overhang.",
          },
          sizeMm: numberField("Fillet radius or chamfer leg length in mm."),
        },
        required: ["id", "kind", "selection", "sizeMm"],
      },
    },
  },
  required: ["name", "base"],
} as const;

const PRINTER_FIELD = stringField(
  "Printer profile id from cad_part_check's error list, e.g. \"bambu-x1c\", \"bambu-p1s\", \"bambu-p2s\", \"bambu-h2d\", \"bambu-h2s\", \"snapmaker-u1\". Required: bed size, nozzle material and bead width all change the answer, so it is asked for rather than assumed.",
);

const MATERIAL_FIELD = stringField(
  "Material profile id: \"pla\", \"petg\", \"abs\", \"asa\", or \"pa-cf\". Required: enclosure, abrasion and shrinkage all follow from it.",
);

export const CAD_PART_TOOL_CATALOG: readonly CadPartToolSpec[] = [
  {
    name: "cad_auth_status",
    label: "Onshape sign-in",
    stage: "auth",
    needs: [],
    // 0 by default: the saved session file answers this offline. verify=true
    // spends exactly one /users/current call to prove the credential still works.
    onshapeCalls: { min: 0, max: 1 },
    mutating: false,
    description:
      "Which Onshape credential this terminal will use and whether it is deducted from your Onshape annual API allowance. Resolution order is saved browser session (`vantage-cad login` — NOT counted against the allowance), then OAuth, then API keys (both counted). Costs 0 Onshape calls; pass verify=true to spend exactly 1 call proving the credential still authenticates. Start here when anything Onshape-related fails.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        verify: boolField("Spend 1 Onshape call on /users/current to prove the saved credential still works (default false)."),
      },
    },
  },
  {
    name: "cad_open_document",
    label: "Open Part Studio",
    stage: "document",
    needs: ["auth"],
    // Exactly one: the element list. That single response carries the Part
    // Studio, its name, and any Feature Studio, so nothing else has to be asked
    // for. A URL with no /w/ workspace comes back as a question, not a lookup.
    onshapeCalls: { min: 1, max: 1 },
    mutating: false,
    description:
      "Bind (or resume) the Part Studio every later tool edits, from a pasted Onshape URL or explicit ids. Also records which Feature Studio in that document holds Vantage's generated FeatureScript, so a later push does not have to go looking for it. Costs exactly 1 Onshape call. Re-binding the same Part Studio resumes its feature history and parameters; binding a different one starts clean. Use a disposable document — never the competition robot.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: stringField("Onshape URL: https://cad.onshape.com/documents/<did>/w/<wid>/e/<eid>. Paste the Part Studio tab's link."),
        documentId: stringField("Document id, if you are not passing a url."),
        workspaceId: stringField("Workspace id, if you are not passing a url."),
        elementId: stringField("Part Studio element id, if you are not passing a url."),
        featureStudioElementId: stringField(
          "Element id of the Feature Studio to write generated FeatureScript into. Optional: one named \"Vantage\" (or the only one in the document) is found from the same element list at no extra cost.",
        ),
      },
    },
  },
  {
    name: "cad_part_studio_contents",
    label: "Part Studio contents",
    stage: "inspect",
    needs: ["auth", "binding"],
    onshapeCalls: { min: 1, max: 1 },
    mutating: false,
    description:
      "List what is already in the bound Part Studio: every feature, which ones Vantage created, and any generated part feature cad_part_edit could change. Costs 1 Onshape call. Read this before pushing into a document you did not just create, so you never add a second copy of a part that is already there.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "cad_part_check",
    label: "Local DFM check",
    stage: "local",
    needs: [],
    onshapeCalls: { min: 0, max: 0 },
    mutating: false,
    description:
      "Run every local design-for-manufacturing rule against the part and return the diameters to actually MODEL. Costs 0 Onshape calls — this is the stage that catches a hole a bolt will not fit through, a wall thinner than two extrusions, an insert boss that is too shallow, or a part that will not fit the bed, before one API call is spent. Needs printerId and materialId. A hole given thread + holeType is resolved from the ISO 273 / tap-drill / heat-set tables instead of being guessed. Returns a checkToken that cad_part_preview and cad_part_push require.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        part: PART_SCHEMA,
        printerId: PRINTER_FIELD,
        materialId: MATERIAL_FIELD,
        inserts: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Boss id -> heat-set insert id, when a bore diameter matches more than one tabulated insert or none. e.g. {\"mount\": \"M3x5.7\"}.",
        },
        overhangs: {
          type: "array",
          description:
            "Sloped faces this prismatic schema cannot express, so the overhang rule can still see them. angleFromVerticalDeg: 0 is a vertical wall, 90 a horizontal roof.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: stringField("What the face is."),
              angleFromVerticalDeg: numberField("Face angle from vertical, in degrees."),
              spanMm: numberField("Unsupported span in mm. Optional."),
            },
            required: ["id", "angleFromVerticalDeg"],
          },
        },
        smallFeatures: {
          type: "array",
          description: "Engraving, pins and other fine detail the schema does not model, so the bead-width rule can see them.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: stringField("What the feature is."),
              minDimensionMm: numberField("Smallest in-plane dimension in mm."),
              kind: { type: "string", enum: ["rib", "pin", "emboss", "engrave", "other"], description: "Optional." },
            },
            required: ["id", "minDimensionMm"],
          },
        },
      },
      required: ["part", "printerId", "materialId"],
    },
  },
  {
    name: "cad_part_preview",
    label: "Preview the feature",
    stage: "local",
    needs: [],
    onshapeCalls: { min: 0, max: 0 },
    mutating: false,
    description:
      "Generate the ONE FeatureScript custom feature that builds the whole part, and show what it would produce: predicted bounding box, every hole centre, every editable parameter with its bounds, the generated source, and the exact Onshape call cost of pushing it. Costs 0 Onshape calls. Pass the checkToken from cad_part_check to preview the print-compensated part — that is the only form cad_part_push accepts. Returns a previewToken.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        checkToken: stringField("checkToken from cad_part_check. Previews the compensated part, and is what makes the result pushable."),
        part: PART_SCHEMA,
        includeSource: boolField("Include the full generated FeatureScript source in the result (default false — the summary already reports its size)."),
        featureScriptVersion: numberField(
          "Onshape FeatureScript language version to pin. Defaults to 2144. Old versions keep working by design; pass your account's own number if you have it.",
        ),
      },
    },
  },
  {
    name: "cad_part_push",
    label: "Push one feature",
    stage: "build",
    needs: ["auth", "binding", "check", "preview"],
    // 2 = write the Feature Studio contents + insert the feature (the write
    // response carries the microversion). 3 when Onshape does not return it and
    // it has to be read back. 4 when the Feature Studio has to be created first.
    onshapeCalls: { min: 2, max: 4 },
    mutating: true,
    description:
      "Write the generated FeatureScript into the document's Feature Studio and insert it into the bound Part Studio as ONE custom feature. Costs 2-4 Onshape calls no matter how many holes, ribs and fillets the part has. Requires a previewToken from cad_part_preview whose DFM check passed. Refuses to push the same part twice — change a dimension with cad_part_edit (1 call) instead of rebuilding it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        previewToken: stringField("previewToken from cad_part_preview. Required."),
        name: stringField("Feature name in the Onshape tree. Defaults to the part name."),
        featureStudioElementId: stringField("Override the Feature Studio recorded by cad_open_document."),
        allowCreateFeatureStudio: boolField(
          "Create a Feature Studio when the document has none (1 extra call). Onshape does not publish this endpoint, so it is opt-in and the result says the endpoint is unverified. Default false: the tool tells you to add the tab yourself.",
        ),
        acknowledgeDfmFail: boolField(
          "Push even though the DFM check returned status=fail. Requires acknowledgedChecks to name every failing rule, and the result records that the part was pushed knowingly.",
        ),
        acknowledgedChecks: {
          type: "array",
          description: "The failing check ids you are accepting, e.g. [\"min-wall\"]. Must cover every fail.",
          items: { type: "string" },
        },
      },
      required: ["previewToken"],
    },
  },
  {
    name: "cad_part_edit",
    label: "Edit parameters",
    stage: "build",
    needs: ["auth", "binding", "push"],
    // 1 for a real change. 0 when every requested value is already the one the
    // feature holds, which is otherwise the easiest way to spend the allowance
    // a call at a time.
    onshapeCalls: { min: 0, max: 1 },
    mutating: true,
    description:
      "Change dimensions on the part feature that is ALREADY in the Part Studio, by feature id. This is what \"make the plate 8 mm instead of 6\" costs: exactly 1 Onshape call updating the existing feature's parameters. Nothing is regenerated, nothing is re-inserted, no Feature Studio is rewritten, so downstream references survive. Costs 0 calls when every parameter in the edit already holds the requested value — re-asserting a dimension never spends anything. Values outside a parameter's published min/max, or a structural change (a new hole group, a different pattern kind, moving an explicit point list), are reported as rebuild-required rather than attempted.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        edits: {
          type: "array",
          description: "The parameter changes. Ids and bounds come from cad_part_preview or cad_part_studio_contents.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              parameterId: stringField("FeatureScript parameter id, e.g. \"baseThickness\" or \"m3CornerDiameter\"."),
              value: numberField("New value: mm for a length, degrees for an angle, a whole number for a count."),
            },
            required: ["parameterId", "value"],
          },
        },
        featureId: stringField("Feature to edit. Defaults to the last part feature this session pushed."),
        recheck: boolField(
          "Re-run the local DFM check on the edited part before spending the call, using the printer and material from the original check (default true when they are known). 0 extra Onshape calls.",
        ),
      },
      required: ["edits"],
    },
  },
  {
    name: "cad_part_verify",
    label: "Verify what was built",
    stage: "verify",
    needs: ["auth", "binding", "push"],
    // Exactly two: one FeatureScript bounding-box readback, one iso shaded view.
    // 0 when nothing has changed since this session already verified it.
    onshapeCalls: { min: 0, max: 2 },
    mutating: false,
    description:
      "The single verification pull: one FeatureScript bounding-box readback and one iso shaded view — 2 Onshape calls total — compared against what the preview predicted. Costs 0 calls when nothing has changed since this session last verified the same feature; it returns the previous readback instead of paying twice for the same answer. The rendered view is written to a file and the path is returned, so it does not flood the transcript.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        featureId: stringField("Feature to measure. Defaults to the last part feature this session pushed."),
        image: {
          type: "string",
          enum: ["path", "base64", "none"],
          description:
            "path (default): write the PNG next to the session file and return its path. base64: return the image inline — large. none: skip the view and spend only the 1 bounding-box call.",
        },
        widthPx: numberField("Rendered width in pixels, 32-2000 (default 700)."),
        heightPx: numberField("Rendered height in pixels, 32-2000 (default 700)."),
      },
    },
  },
];

export function cadPartToolSpec(name: string): CadPartToolSpec | undefined {
  return CAD_PART_TOOL_CATALOG.find((tool) => tool.name === name);
}

export function cadPartToolNames(): string[] {
  return CAD_PART_TOOL_CATALOG.map((tool) => tool.name);
}

/**
 * tools/list entries. The call cost is appended to every description because it
 * is the single fact that most changes what an agent should do next, and MCP
 * gives us nowhere else to put it.
 */
export function cadPartToolListEntries() {
  return CAD_PART_TOOL_CATALOG.map((tool) => ({
    name: tool.name,
    description: `${tool.description}${
      tool.needs.length ? ` Requires: ${tool.needs.join(", ")}.` : ""
    } Onshape calls: ${tool.onshapeCalls.min === tool.onshapeCalls.max ? tool.onshapeCalls.min : `${tool.onshapeCalls.min}-${tool.onshapeCalls.max}`}.`,
    inputSchema: tool.inputSchema,
  }));
}

/** The canonical order, for a status surface or the docs. */
export function cadPartPipelineOrder(): string[] {
  return CAD_PART_TOOL_CATALOG.map((tool) => tool.name);
}
