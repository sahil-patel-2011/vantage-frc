/**
 * Multi-mode CAD agent: pure mode types, deterministic brief classification, and
 * the prompt/parse helpers for "plan" and "multitask" modes.
 *
 * classifyBrief() is intentionally AI-free — mode-fit heuristics must be free and
 * instant, so they run on every chat turn without a metered call.
 */

import { hostedCadToolNames } from "./cad-tool-catalog";
import { describeCadToolDryRun } from "./cad-tool-dry-run";

export const CAD_AGENT_MODES = ["simple", "plan", "multitask"] as const;
export type CadAgentMode = (typeof CAD_AGENT_MODES)[number];

export function isCadAgentMode(value: unknown): value is CadAgentMode {
  return typeof value === "string" && (CAD_AGENT_MODES as readonly string[]).includes(value);
}

/** A mode-switch proposal is consent-gated and expires after 15 seconds. */
export const CAD_MODE_PROPOSAL_TTL_MS = 15_000;

/**
 * True when a stored proposal is too old to accept. Expired proposals are treated
 * as declined server-side so a page reload cannot zombie an expired countdown.
 */
export function isModeProposalExpired(
  proposedAt: string | Date | null | undefined,
  now: number = Date.now(),
  ttlMs: number = CAD_MODE_PROPOSAL_TTL_MS,
): boolean {
  if (!proposedAt) return true;
  const at = proposedAt instanceof Date ? proposedAt.getTime() : new Date(proposedAt).getTime();
  if (!Number.isFinite(at)) return true;
  return now - at > ttlMs;
}

const PART_NOUNS = [
  "plate",
  "bracket",
  "gusset",
  "spacer",
  "standoff",
  "shaft",
  "tube",
  "rail",
  "mount",
  "flange",
  "boss",
  "panel",
  "arm",
  "wheel",
  "hub",
  "pulley",
  "sprocket",
  "gear",
  "gearbox",
  "bellypan",
  "churro",
  "hinge",
  "clamp",
  "roller",
  "link",
  "frame",
  "housing",
  "cover",
  "lid",
  "block",
  "sidewall",
] as const;

const ORDERING_WORDS = ["then", "after", "before", "next", "first", "second", "third", "finally", "once", "afterwards"] as const;

const PLAN_WORDS = ["plan", "steps", "step-by-step", "step by step", "stage", "stages", "outline", "walk me through"] as const;

const MULTI_PART_PHRASES = [
  "several parts",
  "multiple parts",
  "separate parts",
  "set of parts",
  "each part",
  "all the parts",
  "checklist",
  "sub-task",
  "subtask",
] as const;

const UNCERTAINTY_PHRASES = ["not sure", "unsure", "tbd", "you decide", "up to you", "whatever works", "don't know"] as const;

export type CadBriefSignals = {
  words: number;
  partNouns: string[];
  orderingWords: number;
  planWords: number;
  multiPartPhrases: number;
  questionMarks: number;
  uncertaintyPhrases: number;
  dimensionCount: number;
};

function countOccurrences(text: string, needles: readonly string[]): number {
  let total = 0;
  for (const needle of needles) {
    if (/^[a-z-]+$/.test(needle)) {
      const matches = text.match(new RegExp(`\\b${needle.replace(/-/g, "\\-")}\\b`, "g"));
      total += matches?.length ?? 0;
    } else if (text.includes(needle)) {
      total += 1;
    }
  }
  return total;
}

/** Deterministic signal extraction — no AI, no I/O. */
export function analyzeCadBrief(brief: string): CadBriefSignals {
  const text = brief.toLowerCase();
  const partNouns = PART_NOUNS.filter((noun) => new RegExp(`\\b${noun}s?\\b`).test(text));
  // "80×50×6 mm" carries three dimensions: unit-suffixed numbers plus ×/x separators.
  const unitDims = text.match(/\d+(?:\.\d+)?\s*(?:mm|millimet\w*|cm|in\b|inch(?:es)?|")/g)?.length ?? 0;
  const crossDims = text.match(/\d\s*[x×]\s*\d/g)?.length ?? 0;
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    partNouns,
    orderingWords: countOccurrences(text, ORDERING_WORDS),
    planWords: countOccurrences(text, PLAN_WORDS),
    multiPartPhrases: countOccurrences(text, MULTI_PART_PHRASES),
    questionMarks: (text.match(/\?/g) ?? []).length,
    uncertaintyPhrases: countOccurrences(text, UNCERTAINTY_PHRASES),
    dimensionCount: unitDims + crossDims,
  };
}

export type CadBriefClassification = {
  suggestedMode: CadAgentMode;
  reasons: string[];
  signals: CadBriefSignals;
};

/**
 * Suggest the best-fit mode for a brief using deterministic signals only:
 * distinct part nouns, ordering words, question density, dimension count, and
 * explicit plan/multi-part vocabulary.
 */
export function classifyBrief(brief: string): CadBriefClassification {
  const signals = analyzeCadBrief(brief);
  const reasons: string[] = [];

  if (signals.planWords > 0) {
    reasons.push("The brief explicitly asks for a plan or steps.");
    return { suggestedMode: "plan", reasons, signals };
  }
  if (signals.multiPartPhrases > 0 || signals.partNouns.length >= 3) {
    if (signals.multiPartPhrases > 0) reasons.push("The brief talks about multiple separate parts.");
    if (signals.partNouns.length >= 3) {
      reasons.push(`The brief names ${signals.partNouns.length} distinct parts (${signals.partNouns.slice(0, 4).join(", ")}).`);
    }
    return { suggestedMode: "multitask", reasons, signals };
  }
  if (signals.questionMarks >= 2 || signals.uncertaintyPhrases >= 1) {
    reasons.push("The brief leaves open questions — planning first avoids guessed dimensions.");
    return { suggestedMode: "plan", reasons, signals };
  }
  if (signals.orderingWords >= 2) {
    reasons.push("The brief sequences operations (then/after/next) — a numbered plan keeps the order explicit.");
    return { suggestedMode: "plan", reasons, signals };
  }
  if (signals.dimensionCount === 0 && signals.words >= 12) {
    reasons.push("No controlling dimensions were given — planning first surfaces the missing numbers.");
    return { suggestedMode: "plan", reasons, signals };
  }
  reasons.push("A single direct build fits this brief.");
  return { suggestedMode: "simple", reasons, signals };
}

/**
 * Whether the agent should propose a consent-gated switch away from the current
 * mode for this brief. Never proposes a downgrade to "simple" — simple always
 * works, so proposing it would be noise.
 */
export function shouldProposeModeSwitch(
  currentMode: CadAgentMode,
  brief: string,
): { proposedMode: CadAgentMode | null; reasons: string[] } {
  const { suggestedMode, reasons } = classifyBrief(brief);
  if (suggestedMode === currentMode || suggestedMode === "simple") {
    return { proposedMode: null, reasons: [] };
  }
  return { proposedMode: suggestedMode, reasons };
}

// ---------------------------------------------------------------------------
// Plan mode: structured plan + questions
// ---------------------------------------------------------------------------

/**
 * One reviewable plan step. `tool` + `args` make it executable through the
 * ordinary tool executor without a model in the loop; `dryRun` is the pure
 * one-line description a reviewer reads before approving. Steps without a tool
 * are narrative only (older plans, or a step the model could not map) and are
 * executed by the model-driven loop instead.
 */
export type CadPlanStep = {
  index: number;
  title: string;
  detail: string;
  tool?: string;
  args?: Record<string, unknown>;
  dryRun?: string;
  /** cad_job_steps.sequence once persisted, so approve/execute can address the row. */
  sequence?: number;
};

export type CadParsedPlan = { steps: CadPlanStep[]; questions: string[] };

const HOSTED_TOOLS: readonly string[] = hostedCadToolNames();

export function isCadPlanTool(name: unknown): name is string {
  return typeof name === "string" && HOSTED_TOOLS.includes(name);
}

function planArgs(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

/** Attach the pure dry-run sentence to a tool step (idempotent). */
export function withPlanDryRun(step: CadPlanStep): CadPlanStep {
  if (!step.tool) return step;
  return { ...step, dryRun: describeCadToolDryRun(step.tool, step.args ?? {}) };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parse the model's plan JSON: {"plan":{"steps":[...],"questions":[...]}} (or the bare shape). */
export function parseCadPlanResponse(text: string): CadParsedPlan | null {
  const parsed = extractJsonObject(text);
  if (!parsed) return null;
  const container =
    parsed.plan && typeof parsed.plan === "object" && !Array.isArray(parsed.plan)
      ? (parsed.plan as Record<string, unknown>)
      : parsed;
  const rawSteps = container.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;
  const steps: CadPlanStep[] = [];
  for (const raw of rawSteps.slice(0, 20)) {
    if (typeof raw === "string" && raw.trim()) {
      steps.push({ index: steps.length + 1, title: raw.trim(), detail: "" });
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const item = raw as Record<string, unknown>;
      const tool = typeof item.tool === "string" ? item.tool.trim() : "";
      const rationale =
        typeof item.rationale === "string" ? item.rationale.trim() : typeof item.detail === "string" ? item.detail.trim() : "";
      const title = (typeof item.title === "string" ? item.title.trim() : "") || (tool ? tool.replace(/^onshape_/, "").replaceAll("_", " ") : "");
      if (!title) continue;
      const step: CadPlanStep = { index: steps.length + 1, title, detail: rationale };
      if (tool) {
        step.tool = tool;
        step.args = planArgs(item.args ?? item.arguments ?? item.input);
      }
      steps.push(withPlanDryRun(step));
    }
  }
  if (!steps.length) return null;
  const questions = Array.isArray(container.questions)
    ? container.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim()).slice(0, 10)
    : [];
  return { steps, questions };
}

// ---------------------------------------------------------------------------
// Multitask mode: independent sub-task checklist
// ---------------------------------------------------------------------------

export const CAD_TASK_STATUSES = ["pending", "in_progress", "done", "failed"] as const;
export type CadTaskStatus = (typeof CAD_TASK_STATUSES)[number];

export type CadTask = { id: string; title: string; status: CadTaskStatus; note: string };

export function normalizeCadTasks(raw: unknown): CadTask[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const tasks: CadTask[] = [];
  for (const item of raw.slice(0, 8)) {
    if (typeof item === "string" && item.trim()) {
      tasks.push({ id: `t${tasks.length + 1}`, title: item.trim(), status: "pending", note: "" });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) continue;
    const status = (CAD_TASK_STATUSES as readonly string[]).includes(String(record.status))
      ? (record.status as CadTaskStatus)
      : "pending";
    tasks.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `t${tasks.length + 1}`,
      title,
      status,
      note: typeof record.note === "string" ? record.note : "",
    });
  }
  return tasks.length ? tasks : null;
}

/** Parse the model's decomposition JSON: {"tasks":[{"id","title"}...]} (or bare array / strings). */
export function parseCadTasksResponse(text: string): CadTask[] | null {
  const parsed = extractJsonObject(text);
  if (parsed) return normalizeCadTasks(parsed.tasks);
  // Also accept a bare JSON array.
  const trimmed = text.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    return normalizeCadTasks(JSON.parse(trimmed.slice(start, end + 1)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mode prompts
// ---------------------------------------------------------------------------

/**
 * The primitives a plan step may name. Kept in one place so plan mode, multitask
 * decomposition, and the execution prompt all describe the same toolbox.
 */
export const CAD_PLAN_PRIMITIVES = [
  "onshape_sketch_rectangle (widthMm, heightMm, plane, originXMm/originYMm)",
  "onshape_sketch_circle (diameterMm, centerXMm/centerYMm, or circles[])",
  "onshape_sketch_polyline (points [{xMm,yMm}], closed for an extrudable outline)",
  "onshape_sketch_slot (lengthMm end-to-end, widthMm, centre, angleDeg)",
  "onshape_sketch_polygon (sides, acrossFlatsMm or circumscribedDiameterMm, centre)",
  "onshape_sketch_points (explicit points, or gridCountX/gridCountY + gridPitchXMm/gridPitchYMm)",
  "onshape_extrude (depthMm, operationType NEW / ADD / REMOVE / INTERSECT)",
  "onshape_fillet (radiusMm, selection corners|all)",
  "onshape_chamfer (widthMm, selection corners|all)",
  "onshape_hole (diameterMm, endStyle THROUGH|BLIND + depthMm, drilled at the last hole points)",
  "onshape_shell (thicknessMm, faces top|bottom|ends|all)",
  "onshape_set_variable (variableName, value, variableType LENGTH|ANGLE|NUMBER)",
  "onshape_linear_pattern (direction X/Y/Z, spacingMm, instanceCount)",
  "onshape_circular_pattern (axisFeatureId, instanceCount, angleDeg)",
  "onshape_mirror (plane Front/Top/Right)",
  "onshape_export_stl / onshape_export_step (title, changeNote) — saves the file to the team vault",
  "onshape_delete_feature (undo one feature the agent added)",
] as const;

export const CAD_PLAN_MODE_INSTRUCTIONS = [
  "PLAN MODE — do NOT call any Onshape tool yet. Propose the exact tool calls; a human approves them before anything runs.",
  'Reply with ONLY one JSON object, no markdown fences: {"plan":{"steps":[{"tool":"onshape_sketch_rectangle","args":{"widthMm":80,"heightMm":50,"plane":"Top"},"title":"80×50 mm plate outline","rationale":"one line on why"}],"questions":["..."]}}',
  "Steps run in order. Each step is exactly ONE tool call from this list, with every argument in millimetres:",
  ...CAD_PLAN_PRIMITIVES.map((primitive) => `  - ${primitive}`),
  "Chaining: omit sketchFeatureId / featureId / pointSketchFeatureId to use the previous sketch, solid, or point sketch; to name a specific earlier step write the string \"{{step:N.featureId}}\" where N is that step's 1-based number.",
  "Each title restates the dimensions and the sketch plane. The rationale is one short line.",
  "A hole pattern is one onshape_sketch_points step plus one onshape_hole step — do not add a pattern step unless the repeated thing is an existing feature.",
  "For anything ambiguous (mount hole spacing, material/stock thickness, clearance, missing controlling dimensions) add a question and leave that step out — never guess a number.",
  "Keep the plan to at most 12 steps. Use only real data from the brief and the team context below; never invent measurements.",
].join("\n");

export const CAD_MULTITASK_DECOMPOSE_INSTRUCTIONS = [
  "MULTITASK MODE — decomposition step. Do NOT call any Onshape tool yet.",
  'Reply with ONLY one JSON object, no markdown fences: {"tasks":[{"id":"t1","title":"..."}]}',
  "Split the brief into 2 to 6 independent sub-tasks (e.g. plate outline / hole pattern / corner fillets / pocketing).",
  "Each sub-task must be buildable from these primitives: " + CAD_PLAN_PRIMITIVES.join("; ") + ".",
  "Each title is one concrete deliverable. They will run sequentially through one Onshape session and share one step budget.",
].join("\n");

export function cadPlanExecutionPreamble(input: {
  steps: CadPlanStep[];
  questions: string[];
  answers: string[];
}): string {
  const lines = [
    "Execute this APPROVED build plan step by step, in order, one JSON tool hop at a time.",
    "Narrate as you go: your final message must recap each executed step as 'Step N: <title> — <what happened>'.",
    "Steps:",
    ...input.steps.map((step) => `${step.index}. ${step.title}${step.detail ? ` — ${step.detail}` : ""}`),
  ];
  if (input.questions.length) {
    lines.push("Answered questions:");
    input.questions.forEach((question, index) => {
      lines.push(`Q: ${question}\nA: ${input.answers[index]?.trim() || "(no answer given — ask before assuming)"}`);
    });
  }
  lines.push("If an answer is missing for a controlling dimension, stop and ask instead of guessing.");
  return lines.join("\n");
}

export function cadMultitaskExecutionPreamble(task: CadTask, position: number, total: number): string {
  return [
    `Sub-task ${position} of ${total}: ${task.title} (id ${task.id}).`,
    "Work ONLY on this sub-task now. Sub-tasks run sequentially through one Onshape session.",
    "When this sub-task's geometry is done (or blocked), reply with a final message summarising exactly what happened for this sub-task.",
  ].join("\n");
}
