import { CAD_TOOL_CATALOG, hostedCadToolNames } from "./cad-tool-catalog";

export type CadAgentAction =
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }
  | { type: "final"; answer: string };

/**
 * The hosted web agent runs the Onshape half of the catalog. Fusion needs a
 * loopback relay on the user's PC, so it can never run on Vercel — the /cad UI
 * labels those tools "Onshape only" instead of letting the agent try them.
 */
const WEB_CAD_TOOL_NAMES: readonly string[] = hostedCadToolNames();

function toolLine(name: string): string {
  const tool = CAD_TOOL_CATALOG.find((entry) => entry.name === name);
  if (!tool) return `- ${name}`;
  const required = tool.params.filter((param) => param.required).map((param) => param.name);
  return `- ${tool.name}${required.length ? `(${required.join(", ")})` : "()"}: ${tool.description}`;
}

export const WEB_CAD_AGENT_INSTRUCTIONS = [
  "You are Vantage's hosted CAD agent, the same Onshape loop as Claude-CodeCad.",
  "You drive a live Onshape Part Studio. There is no mock geometry and no OpenSCAD compiler on this server.",
  "Reply with ONLY one JSON object per hop, no markdown fences:",
  '{"tool":"<tool_name>","arguments":{...}}',
  'or when the user should read a message and no tool is needed: {"final":"<text>"}',
  "",
  "Tools you may call:",
  ...WEB_CAD_TOOL_NAMES.map(toolLine),
  "",
  "Build recipes — decompose a brief into these primitives, do not describe CAD instead of building it:",
  "- Flat plate: onshape_sketch_rectangle (mm, on a named plane) → onshape_extrude (depth = stock thickness).",
  "- Rounded corners: onshape_fillet with selection='corners' right after the extrude; it resolves the real",
  "  corner edges of that extrude. selection='all' rounds every edge instead.",
  "- Bolt row / hole grid: onshape_sketch_points (explicit points, or gridCountX + gridPitchXMm) →",
  "  onshape_hole (diameterMm, THROUGH by default). One hole feature covers every point — do not pattern it.",
  "- Repeat an existing feature: onshape_linear_pattern (direction X/Y/Z + spacingMm + instanceCount) or",
  "  onshape_circular_pattern (axisFeatureId must name a feature with a cylindrical face) or onshape_mirror.",
  "- Pocket / cutout: sketch the profile, then onshape_extrude with operationType='REMOVE'.",
  "- Round boss or bore: onshape_sketch_circle then onshape_extrude (ADD or REMOVE).",
  "- Non-rectangular outline (gusset, bellypan): onshape_sketch_polyline with closed=true.",
  "- Wrong step? onshape_delete_feature removes the feature you just added. It refuses to delete anything",
  "  the agent did not create, so never promise to clean up hand-built history.",
  "",
  "Rules:",
  "If no Part Studio is bound, call onshape_list_documents then onshape_bind, or tell the user to paste an Onshape URL and click Bind.",
  "Chain by featureId: every mutating tool returns one, and each tool defaults to the right previous feature.",
  "Never invent DEMO metrics, feature ids, or pretend a mutation succeeded. If a tool returns setup_required, say so and stop.",
  "If a tool reports that no geometry matched, report that honestly — do not retry with a made-up id.",
  "Fusion 360 is not available in this hosted agent — use Onshape only.",
  "Spatial guardrails: always restate every dimension in millimetres before using it (convert inches explicitly).",
  "For every feature, state the sketch plane (Top/Front/Right) and the origin reference the sketch is measured from.",
  "Check that pocket or cut depths never exceed the stock thickness; if a cut would break through unintentionally, stop and ask.",
  "If the brief lacks a controlling dimension (length, width, thickness, hole spacing), do not guess — reply with a final message asking for it.",
  "Finish with a final message that lists what was built, step by step, with the dimensions actually used.",
  "Not certified engineering software. Prefer a disposable document.",
].join("\n");

/**
 * Step budget for one turn. A realistic FRC brief ("plate with a 4x pattern of
 * 5 mm holes and filleted corners") is sketch → extrude → points → hole →
 * fillet → final = 6 hops, so the budget has to clear that with room to recover
 * from one failed hop. Multitask mode still shares this single budget across all
 * of its sub-tasks, so the cap is enforced overall, not per sub-task.
 */
export const WEB_CAD_AGENT_MAX_STEPS = 14;

/** Parse Claude-CodeCad JSON hops and the autonomous-agent aliases. */
export function parseCadAgentAction(text: string): CadAgentAction | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof parsed.final === "string") {
      return { type: "final", answer: parsed.final.trim() };
    }
    if (parsed.type === "final" && typeof parsed.answer === "string") {
      return { type: "final", answer: parsed.answer.trim() };
    }
    const tool =
      typeof parsed.tool === "string"
        ? parsed.tool.trim()
        : parsed.type === "tool_call" && typeof parsed.tool === "string"
          ? parsed.tool.trim()
          : "";
    if (tool) {
      const rawArgs = parsed.arguments ?? parsed.input ?? parsed.args;
      const input =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : {};
      return { type: "tool_call", tool, input };
    }
    if (typeof parsed.answer === "string") {
      return { type: "final", answer: parsed.answer.trim() };
    }
  } catch {
    return null;
  }
  return null;
}

export function isWebCadAgentTool(name: string): boolean {
  return WEB_CAD_TOOL_NAMES.includes(name);
}

export function webCadAgentToolNames(): readonly string[] {
  return WEB_CAD_TOOL_NAMES;
}
