/**
 * Agent narration — "show your work".
 *
 * Product principle (docs/archive/AI_MENTOR_CONCEPT.md): "the agent narrates every operation it performs;
 * work done silently is work nobody learned from." Community research (docs/archive/COMMUNITY_DEMAND_RND.md)
 * found the loudest unmet demand is knowledge transfer, and zero demand for AI that quietly does the
 * work. So: teach visibly, automate quietly.
 *
 * HARD RULE — the `why` of a narration is always VERBATIM text lifted from the underlying data.
 * There is no code path that composes a reason. If the tool result, the params, or the finding
 * carry no reason, the narration reports what happened and omits the why. `principle` is separate,
 * clearly labelled, keyed by a real identifier, and never claims to be the reason for this step.
 *
 * Pure module: no React, no DB, no network. Unit-tested in narration.test.ts.
 */

import { CODE_RULE_LESSONS, STEP_KIND_PRINCIPLES, TOOL_PRINCIPLES } from "./catalog";

export { CODE_RULE_LESSONS, STEP_KIND_PRINCIPLES, TOOL_PRINCIPLES };
export type { CodeRuleLesson } from "./catalog";

export type NarrationStatus = "ok" | "empty" | "setup_required" | "error" | "pending";

export type NarrationOrigin = "tool_call" | "code_finding" | "agent_step";

export type NarrationSource = {
  /** Short label for the evidence (a file:line, a URL, "Result excerpt"). */
  label: string;
  url?: string;
  /** Verbatim excerpt already present in the data. Never paraphrased. */
  excerpt?: string;
};

export type Narration = {
  /** 1-based ordinal within the narrated sequence. */
  step: number;
  /** What the agent did, built only from the tool name and the params that were really present. */
  action: string;
  /** Factual result carried by the data (summary / error text). Not a reason. */
  outcome?: string;
  /** WHY — verbatim from the data, or absent. Never composed. */
  why?: string;
  /** General engineering practice for this operation type, from the authored catalog. */
  principle?: string;
  sources?: NarrationSource[];
  status: NarrationStatus;
  origin: NarrationOrigin;
  /** Stable identity for caching an "explain this differently" response. */
  key: string;
};

const MAX_WHY = 400;
const MAX_ACTION = 240;
const MAX_OUTCOME = 400;
const MAX_EXCERPT = 600;

/**
 * Field names that carry an author-supplied reason. Order is priority order.
 * A narration's `why` may only ever come from one of these.
 */
const REASON_FIELDS = [
  "reason",
  "rationale",
  "why",
  "designIntent",
  "design_intent",
  "intent",
  "justification",
  "explanation",
] as const;

const STATUSES: readonly NarrationStatus[] = ["ok", "empty", "setup_required", "error", "pending"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Trim + length-cap only. Never rewords, so the output stays a substring of the input. */
function verbatim(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function humanize(id: string): string {
  return id.replaceAll("_", " ").replaceAll("-", " ").trim();
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The ONLY producer of `why`. Reads an explicit reason field off a record (and one level into
 * `meta`). Returns undefined when the data carries no reason — which is the honest outcome.
 */
export function readReason(source: unknown): string | undefined {
  const record = asRecord(source);
  if (!record) return undefined;
  for (const field of REASON_FIELDS) {
    const found = verbatim(record[field], MAX_WHY);
    if (found) return found;
  }
  const meta = asRecord(record.meta);
  if (meta) {
    for (const field of REASON_FIELDS) {
      const found = verbatim(meta[field], MAX_WHY);
      if (found) return found;
    }
  }
  return undefined;
}

function normalizeStatus(value: unknown, fallback: NarrationStatus): NarrationStatus {
  const raw = str(value);
  if (raw && (STATUSES as readonly string[]).includes(raw)) return raw as NarrationStatus;
  return fallback;
}

function statusFromResult(result: unknown): NarrationStatus {
  if (result === undefined || result === null) return "pending";
  const record = asRecord(result);
  if (!record) return "ok";
  if (record.setupRequired === true) return "setup_required";
  const explicit = str(record.status);
  if (explicit && (STATUSES as readonly string[]).includes(explicit)) return explicit as NarrationStatus;
  if (str(record.error)) return "error";
  if (record.ok === false) return "error";
  return "ok";
}

function outcomeFromResult(result: unknown): string | undefined {
  const record = asRecord(result);
  if (!record) return undefined;
  return (
    verbatim(record.summary, MAX_OUTCOME) ??
    verbatim(record.message, MAX_OUTCOME) ??
    verbatim(record.error, MAX_OUTCOME) ??
    verbatim(record.detail, MAX_OUTCOME)
  );
}

function sourcesFrom(...candidates: unknown[]): NarrationSource[] | undefined {
  const out: NarrationSource[] = [];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) continue;
    const url = str(record.sourceUrl) ?? str(record.url);
    if (url && /^https?:\/\//i.test(url) && !out.some((item) => item.url === url)) {
      out.push({ label: url, url });
    }
  }
  return out.length ? out : undefined;
}

/* ------------------------------------------------------------------ */
/* Tool-call action phrasing — built only from params that are present */
/* ------------------------------------------------------------------ */

type ActionFormatter = (params: Record<string, unknown>) => string;

const TOOL_ACTIONS: Record<string, ActionFormatter> = {
  onshape_sketch_rectangle: (p) => rectangleAction("Sketched", p),
  fusion_sketch_rectangle: (p) => rectangleAction("Sketched", p),
  onshape_extrude: (p) => extrudeAction(p),
  fusion_extrude: (p) => extrudeAction(p),
  onshape_describe: () => "Listed the features already in the bound Part Studio",
  fusion_describe: () => "Read the open Fusion design's body and feature counts",
  onshape_bind: (p) => {
    const doc = str(p.documentId);
    return doc ? `Bound the session to Onshape document ${doc}` : "Bound the session to an Onshape Part Studio";
  },
  onshape_list_documents: () => "Listed the Onshape documents this workspace can reach",
  onshape_list_elements: (p) => {
    const doc = str(p.documentId);
    return doc ? `Listed the elements in Onshape document ${doc}` : "Listed the elements in the Onshape document";
  },
  cad_status: () => "Checked the CAD connector status",
  cad_setup: () => "Read the CAD connector setup requirements",
  fusion_status: () => "Pinged the local Fusion relay",
  "web.search": (p) => {
    const query = str(p.query);
    return query ? `Searched the web for "${query}"` : "Ran a web search";
  },
  "web.fetch": (p) => {
    const url = str(p.url);
    return url ? `Fetched ${url}` : "Fetched an allowlisted page";
  },
};

function rectangleAction(verb: string, p: Record<string, unknown>): string {
  const width = num(p.widthMm);
  const height = num(p.heightMm);
  const plane = str(p.plane);
  const name = str(p.name);
  let action =
    width != null && height != null
      ? `${verb} a ${fmt(width)} × ${fmt(height)} mm rectangle`
      : `${verb} a rectangle`;
  if (plane) action += ` on the ${plane} plane`;
  if (name) action += ` named "${name}"`;
  return action;
}

function extrudeAction(p: Record<string, unknown>): string {
  const depth = num(p.depthMm);
  const sketch = str(p.sketchFeatureId);
  let action = depth != null ? `Extruded the sketch ${fmt(depth)} mm` : "Extruded the sketch";
  if (sketch) action += ` from sketch feature ${sketch}`;
  return action;
}

/** Fallback phrasing for a tool with no dedicated formatter — lists only primitive params present. */
function genericAction(toolName: string, params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (parts.length >= 4) break;
    if (typeof value === "string" && value.trim()) parts.push(`${key}=${value.trim().slice(0, 60)}`);
    else if (typeof value === "number" && Number.isFinite(value)) parts.push(`${key}=${fmt(value)}`);
    else if (typeof value === "boolean") parts.push(`${key}=${value}`);
  }
  const base = `Ran ${humanize(toolName)}`;
  return parts.length ? `${base} (${parts.join(", ")})` : base;
}

function actionFor(toolName: string, params: Record<string, unknown>): string {
  const formatter = TOOL_ACTIONS[toolName];
  const action = formatter ? formatter(params) : genericAction(toolName, params);
  return action.length > MAX_ACTION ? `${action.slice(0, MAX_ACTION).trimEnd()}…` : action;
}

/* ---------------------------------------- */
/* Builders                                 */
/* ---------------------------------------- */

export type ToolCallNarrationOptions = {
  /** 1-based ordinal. Defaults to 1; batch helpers renumber. */
  step?: number;
  status?: NarrationStatus;
};

/**
 * Narrate one executed agent/CAD tool call from its real name, params, and result.
 * `why` appears only when the params or result carry an explicit reason field.
 */
export function fromToolCall(
  toolName: string,
  params?: unknown,
  result?: unknown,
  options: ToolCallNarrationOptions = {},
): Narration {
  const name = str(toolName) ?? "unknown_tool";
  const p = asRecord(params) ?? {};
  const step = Math.max(1, Math.trunc(options.step ?? 1));
  const why = readReason(p) ?? readReason(result);
  const narration: Narration = {
    step,
    action: actionFor(name, p),
    status: options.status ?? statusFromResult(result),
    origin: "tool_call",
    key: `tool:${name}:${step}`,
  };
  const outcome = outcomeFromResult(result);
  if (outcome) narration.outcome = outcome;
  if (why) narration.why = why;
  const principle = TOOL_PRINCIPLES[name];
  if (principle) narration.principle = principle;
  const sources = sourcesFrom(result, p);
  if (sources) narration.sources = sources;
  return narration;
}

/** Shape shared by local Code Coach risks (CodeRisk) and grounded Bugbot findings. */
export type CodeFindingLike = {
  severity?: string | null;
  /** Rule id that matched. Also the catalog key for the teaching principle. */
  pattern?: string | null;
  /** CodeRisk carries `message`; a Bugbot finding carries `finding`. Either is the why. */
  message?: string | null;
  finding?: string | null;
  /** Quoted line(s) from the student's own source. */
  evidence?: string | null;
  location?: string | null;
  line?: number | null;
  source?: string | null;
};

/**
 * Narrate one code review finding: what rule fired, why it matters (the rule's own recorded
 * message — never composed), and the habit that prevents it.
 */
export function fromCodeFinding(finding: CodeFindingLike, options: { step?: number } = {}): Narration {
  const step = Math.max(1, Math.trunc(options.step ?? 1));
  const pattern = str(finding.pattern);
  const severity = str(finding.severity);
  const location = str(finding.location);
  const line = num(finding.line);
  const label = pattern ? humanize(pattern) : "a risk pattern";
  const where = location ? ` in ${location}${line != null && line > 0 ? `:${fmt(line)}` : ""}` : "";
  const action = severity
    ? `Flagged ${severity}-severity ${label}${where}`
    : `Flagged ${label}${where}`;

  const narration: Narration = {
    step,
    action: action.length > MAX_ACTION ? `${action.slice(0, MAX_ACTION).trimEnd()}…` : action,
    status: "ok",
    origin: "code_finding",
    key: `finding:${pattern ?? location ?? "unknown"}:${line ?? 0}:${step}`,
  };

  // The rule's recorded message IS the reason the finding exists. Absent message -> absent why.
  const why = verbatim(finding.message, MAX_WHY) ?? verbatim(finding.finding, MAX_WHY);
  if (why) narration.why = why;

  const lesson = pattern ? CODE_RULE_LESSONS[pattern] : undefined;
  if (lesson) narration.principle = lesson.habit;

  const evidence = verbatim(finding.evidence, MAX_EXCERPT);
  if (evidence) {
    narration.sources = [
      {
        label: location ? `${location}${line != null && line > 0 ? `:${fmt(line)}` : ""}` : "matched source line",
        excerpt: evidence,
      },
    ];
  }
  return narration;
}

/** One persisted step of the autonomous (ReAct) agent run. */
export type AgentStepLike = {
  sequence?: number | null;
  kind?: string | null;
  toolName?: string | null;
  argsSummary?: string | null;
  resultSummary?: string | null;
  resultExcerpt?: string | null;
  sourceUrl?: string | null;
  status?: string | null;
};

/**
 * Narrate one autonomous-agent step. Plan steps only get a `why` when the model's recorded
 * JSON actually carried a reason field — the usual case is no reason, and we say nothing.
 */
export function fromChatToolUse(step: AgentStepLike, options: { step?: number } = {}): Narration {
  const ordinal = Math.max(1, Math.trunc(options.step ?? num(step.sequence) ?? 1));
  const kind = str(step.kind) ?? "tool";
  const toolName = str(step.toolName);
  const parsedArgs = asRecord(tryParseJson(step.argsSummary)) ?? {};
  const parsedPlan = tryParseJson(step.resultSummary);

  let action: string;
  if (kind === "tool" && toolName) action = actionFor(toolName, parsedArgs);
  else if (kind === "observe")
    action = toolName
      ? `Fed the ${toolName} result into the next step's context`
      : "Fed the tool result into the next step's context";
  else if (kind === "plan") action = "Chose the next step";
  else if (kind === "generation") action = "Wrote the final answer";
  else if (kind === "error") action = "Stopped on an error";
  else action = toolName ? actionFor(toolName, parsedArgs) : `Ran a ${humanize(kind)} step`;

  const narration: Narration = {
    step: ordinal,
    action: action.length > MAX_ACTION ? `${action.slice(0, MAX_ACTION).trimEnd()}…` : action,
    status: normalizeStatus(step.status, "ok"),
    origin: "agent_step",
    key: `agent:${kind}:${toolName ?? "none"}:${ordinal}`,
  };

  // A plan step's why can only come from a reason the model actually recorded in its JSON.
  const why = readReason(parsedPlan) ?? readReason(parsedArgs);
  if (why) narration.why = why;

  // resultSummary is what came back, not why it was done — kept strictly separate from `why`.
  const outcome = verbatim(step.resultSummary, MAX_OUTCOME);
  if (outcome && outcome !== narration.why) narration.outcome = outcome;

  const principle = (toolName ? TOOL_PRINCIPLES[toolName] : undefined) ?? STEP_KIND_PRINCIPLES[kind];
  if (principle) narration.principle = principle;

  const sources: NarrationSource[] = [];
  const url = str(step.sourceUrl);
  if (url) sources.push({ label: url, url: /^https?:\/\//i.test(url) ? url : undefined });
  const excerpt = verbatim(step.resultExcerpt, MAX_EXCERPT);
  if (excerpt) sources.push({ label: "Recorded result excerpt", excerpt });
  if (sources.length) narration.sources = sources;

  return narration;
}

/* ---------------------------------------- */
/* Batch helpers (renumber to 1..n)          */
/* ---------------------------------------- */

function renumber(list: Narration[]): Narration[] {
  return list.map((item, index) => {
    const step = index + 1;
    return { ...item, step, key: item.key.replace(/:\d+$/, `:${step}`) };
  });
}

export function narrateToolCalls(
  calls: Array<{ toolName: string; params?: unknown; result?: unknown; status?: NarrationStatus }>,
): Narration[] {
  return renumber(
    calls.map((call, index) =>
      fromToolCall(call.toolName, call.params, call.result, { step: index + 1, status: call.status }),
    ),
  );
}

export function narrateCodeFindings(findings: CodeFindingLike[]): Narration[] {
  return renumber(findings.map((finding, index) => fromCodeFinding(finding, { step: index + 1 })));
}

export function narrateAgentRun(steps: AgentStepLike[]): Narration[] {
  return renumber(steps.map((step, index) => fromChatToolUse(step, { step: index + 1 })));
}

/** Honest header counts for the panel: how much of this run actually recorded a reason. */
export function narrationCoverage(list: Narration[]): {
  total: number;
  explained: number;
  unexplained: number;
} {
  const explained = list.filter((item) => Boolean(item.why)).length;
  return { total: list.length, explained, unexplained: list.length - explained };
}

/* ---------------------------------------- */
/* "Explain this differently"                */
/* ---------------------------------------- */

export type ExplainLevel = "new" | "maths";

export const EXPLAIN_LEVELS: Array<{ id: ExplainLevel; label: string; hint: string }> = [
  { id: "new", label: "Like I'm new", hint: "Plain language, no jargon, one concrete analogy." },
  { id: "maths", label: "Give me the maths", hint: "The governing relationship and the units." },
];

export function isExplainLevel(value: unknown): value is ExplainLevel {
  return value === "new" || value === "maths";
}

/**
 * Grounding prompt for feature="explain_step". The model may only re-express the recorded step —
 * it is told explicitly what is absent so it reports the gap instead of filling it.
 */
export function buildExplainPrompt(narration: Narration, level: ExplainLevel): string {
  const lines: string[] = [
    "You are an FRC build-season mentor explaining ONE recorded agent step to a student.",
    "",
    "RECORDED STEP — this is the complete record. Nothing else is known.",
    `- Step: ${narration.step}`,
    `- What happened: ${narration.action}`,
    `- Status: ${narration.status}`,
  ];
  if (narration.outcome) lines.push(`- Result recorded: ${narration.outcome}`);
  lines.push(
    narration.why
      ? `- Reason recorded with the step: ${narration.why}`
      : "- Reason recorded with the step: NONE. No reason was recorded.",
  );
  if (narration.principle) lines.push(`- General practice for this operation: ${narration.principle}`);
  for (const source of narration.sources ?? []) {
    lines.push(`- Evidence: ${source.label}${source.excerpt ? ` — "${source.excerpt}"` : ""}`);
  }
  lines.push(
    "",
    level === "new"
      ? "Re-explain this for someone in their first season: plain language, no jargon, at most one short analogy."
      : "Re-explain this quantitatively: name the governing relationship and the units involved.",
    "",
    "RULES:",
    "- Use ONLY the recorded step above. Do not introduce numbers, part names, files, or rules that are not in it.",
    "- If no reason was recorded, say plainly that the step has no recorded reason and explain only what the operation does in general. Do not guess the intent.",
    "- If the recorded facts are not enough to answer at this level, say exactly what is missing.",
    "- 120 words maximum. No preamble, no sign-off.",
  );
  return lines.join("\n");
}
