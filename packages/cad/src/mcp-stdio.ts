/**
 * The `vantage-cad mcp` server: JSON-RPC framing, the per-operation Onshape /
 * Fusion tools from claude-cad.ts, and the part pipeline.
 *
 * WHY THE PIPELINE EXISTS. Onshape's API allowance is ANNUAL and small — 2,500
 * to 10,000 calls per year depending on plan, pooled per company
 * (https://onshape-public.github.io/docs/auth/limits/, verified 2026-08-25). A
 * sketch -> extrude -> describe -> render loop spends one call per operation and
 * can burn a season's allowance in an afternoon. Two facts fix that, and both
 * are load-bearing here:
 *
 *  1. Calls made with a signed-in browser session are NOT counted against the
 *     allowance (same page: calls from "the Onshape browser, mobile clients, or
 *     the Onshape API Explorer (when authenticated via an Onshape session)" do
 *     not count). `vantage-cad login` puts such a session on disk;
 *     onshape-session.ts prefers it and says out loud when it cannot.
 *  2. ONE FeatureScript custom feature builds the whole solid, so a plate with
 *     four counterbored holes and filleted corners costs the same as a bare
 *     plate. featurescript/generate.ts is that generator.
 *
 * WHAT THIS FILE ENFORCES. The canonical flow is local check -> preview -> push
 * one feature -> single verification pull, and it is enforced here rather than
 * merely documented: `cad_part_push` will not accept a preview it cannot trace
 * back to a passing local check, will not push the same part twice, and
 * `cad_part_verify` will not pay twice for the same answer. Every result carries
 * the running call ledger — this tool's calls, and the lifetime tally from this
 * machine — so the cost is visible to the agent and to the user as it accrues.
 *
 * WHAT IT REFUSES TO GUESS. A missing printer, material, or hole type comes back
 * as a structured `needs_clarification` naming the options, because an M3 hole is
 * 3.4 mm as clearance, 2.5 mm tapped and 4.0 mm for a heat-set insert, and
 * picking one silently produces a part that has to be reprinted. Where a real
 * default exists (ISO 273 "normal" clearance), it is applied AND reported in
 * `defaultsApplied`.
 *
 * Nothing here resolves a credential or opens a connection at import time.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CAD_PART_TOOL_CATALOG,
  cadPartToolListEntries,
  cadPartToolSpec,
  type CadPartToolPrecondition,
} from "./cad-tool-catalog";
import {
  createCallBudget,
  describeCallTally,
  ONSHAPE_ANNUAL_CALL_LIMITS,
  type CallBudget,
  type CallBudgetSummary,
  type PersistedCallTally,
} from "./call-budget";
import { CLAUDE_CAD_TOOLS, callClaudeCadTool } from "./claude-cad";
import {
  bindClaudeCadSession,
  findSessionFeature,
  loadClaudeCadSession,
  noteSessionCalls,
  recordSessionFeature,
  saveClaudeCadSession,
  summarizeClaudeCadSession,
  updateSessionFeatureParameters,
  type CadSessionParameters,
  type ClaudeCadSession,
} from "./claude-session";
import {
  applyDfmCompensation,
  checkPart,
  clearanceHoleMm,
  defaultInsertIdForThread,
  describeDfmReport,
  findMaterial,
  findPrinter,
  isMetricThread,
  MATERIAL_PROFILES,
  PRINTER_PROFILES,
  requiredBoreDepthMm,
  requireInsert,
  tapDrillMm,
  type CheckPartInput,
  type DfmReport,
  type ModelledPart,
} from "./dfm";
import {
  boundingBoxScript,
  compareBoundingBox,
  describePartPreview,
  dryRunPart,
  generatePartFeatureScript,
  isoShadedViewPath,
  parseBoundingBoxReadback,
  planParameterEdit,
  type GeneratedPartFeature,
  type PartPreview,
} from "./featurescript";
import { explainFeatureTreeForStudents, type OnshapeFeatureSummary } from "./onshape";
import {
  customFeatureCall,
  customFeatureNamespace,
  customFeatureUpdateCall,
  featureStudioContentsPayload,
  onshapeFeaturePath,
  onshapeFeatureStudioPath,
  parseAddedFeatureId,
  parseFeatureStudioMicroversion,
  ONSHAPE_SERIALIZATION_VERSION,
} from "./onshape-features";
import { collectFeatureScriptStrings } from "./onshape-resolve";
import {
  ONSHAPE_AUTH_SETUP_MESSAGE,
  OnshapeAuthUnavailableError,
  OnshapeSessionExpiredError,
  probeOnshapeIdentity,
  resolveOnshapeAuth,
  type OnshapeAuthResolution,
  type OnshapeHttpFn,
  type ResolveOnshapeAuthOptions,
} from "./onshape-session";
import {
  loadOnshapeBrowserSession,
  onshapeSessionStatus,
  vantageCadHome,
} from "./onshape-session-store";
import { onshapeDocumentOpenUrl, parseOnshapeDocumentUrl } from "./onshape-url";

const PROTOCOL_VERSION = "2024-11-05";

const ONSHAPE_LIMITS_URL = "https://onshape-public.github.io/docs/auth/limits/";

/**
 * Session-file keys for the facts a later process needs to EDIT a feature
 * instead of rebuilding it: which FeatureScript feature it is, which Feature
 * Studio namespace it came from, and the definition it was generated from.
 *
 * They live in `CadSessionFeature.parameters` alongside the numeric parameter
 * values. The dot is what keeps them apart: a generated FeatureScript parameter
 * id matches /^[A-Za-z][A-Za-z0-9]{0,63}$/, so it can never collide with one of
 * these.
 */
const META = {
  featureType: "vantage.featureType",
  namespace: "vantage.namespace",
  featureStudio: "vantage.featureStudio",
  definition: "vantage.definition",
  printerId: "vantage.printerId",
  materialId: "vantage.materialId",
  previewToken: "vantage.previewToken",
} as const;

/**
 * A part definition is a few hundred bytes of JSON; this ceiling only exists so
 * a pathological explicit point list cannot bloat the session file. Past it the
 * definition is not stored and cad_part_edit says why instead of guessing.
 */
const DEFINITION_STORE_LIMIT = 8_000;

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// JSON-RPC framing
// ---------------------------------------------------------------------------

type JsonRpc = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

function writeFrame(message: unknown) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

export type CadMcpHooks = {
  /**
   * Observes every tools/call after it ran (ok=false carries the error text).
   * Used by the vantage-cad CLI to sync terminal sessions to the web app.
   * Must never throw and never write to stdout (stdout is MCP protocol).
   */
  onToolCall?: (name: string, args: Record<string, unknown>, ok: boolean, error?: string) => void | Promise<void>;
};

// ---------------------------------------------------------------------------
// Runtime seams (tests inject; production uses the real disk + network)
// ---------------------------------------------------------------------------

export type CadPartRuntime = {
  resolveAuth?: (options: ResolveOnshapeAuthOptions) => Promise<OnshapeAuthResolution>;
  loadSession?: () => Promise<ClaudeCadSession>;
  saveSession?: (session: ClaudeCadSession) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Where a verification render is written. Defaults to ~/.vantage-cad/views. */
  viewDir?: string;
};

function runtimeEnv(runtime: CadPartRuntime): NodeJS.ProcessEnv {
  return runtime.env ?? process.env;
}

async function loadSession(runtime: CadPartRuntime): Promise<ClaudeCadSession> {
  if (runtime.loadSession) return runtime.loadSession();
  return loadClaudeCadSession(runtimeEnv(runtime));
}

async function saveSession(runtime: CadPartRuntime, session: ClaudeCadSession): Promise<void> {
  if (runtime.saveSession) {
    await runtime.saveSession(session);
    return;
  }
  await saveClaudeCadSession(session, runtimeEnv(runtime));
}

// ---------------------------------------------------------------------------
// Pipeline state
// ---------------------------------------------------------------------------

type CheckedPart = {
  token: string;
  part: ModelledPart;
  /** The part with every compensated diameter written in — what actually gets built. */
  compensated: ModelledPart;
  report: DfmReport;
  printerId: string;
  materialId: string;
};

type PreviewedPart = {
  token: string;
  /** null when the caller previewed a raw part, which cad_part_push then refuses. */
  checkToken: string | null;
  part: ModelledPart;
  generated: GeneratedPartFeature;
  preview: PartPreview;
};

type VerifiedFeature = {
  featureId: string;
  rebuild: number;
  result: Json;
};

const STATE_LIMIT = 12;

const checkedParts = new Map<string, CheckedPart>();
const previewedParts = new Map<string, PreviewedPart>();
const verifiedFeatures = new Map<string, VerifiedFeature>();
/** Feature Studio discovered by cad_open_document, keyed by "did/wid". */
const featureStudioByBinding = new Map<string, string>();
/** Feature ids pushed in this process, newest last. */
let pushedFeatureIds: string[] = [];

function remember<T>(store: Map<string, T>, key: string, value: T) {
  store.delete(key);
  store.set(key, value);
  while (store.size > STATE_LIMIT) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/** Drop every in-process pipeline memory. Exported for tests; nothing on disk changes. */
export function resetCadPartPipeline(): void {
  checkedParts.clear();
  previewedParts.clear();
  verifiedFeatures.clear();
  featureStudioByBinding.clear();
  pushedFeatureIds = [];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Json)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function tokenFor(prefix: string, payload: unknown): string {
  return `${prefix}_${createHash("sha256").update(stableStringify(payload)).digest("hex").slice(0, 16)}`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Structured answers
// ---------------------------------------------------------------------------

/** One thing the tool will not guess, with the options it would accept. */
type Clarification = {
  field: string;
  question: string;
  options?: string[];
  why: string;
};

/** A default that WAS applied, so it is visible rather than silent. */
type AppliedDefault = {
  field: string;
  value: string;
  source: string;
};

type ToolBudgetView = {
  authPath: string | null;
  countsAgainstAnnualCap: boolean;
  callsThisTool: number;
  chargedToAnnualCapThisTool: number;
  headline: string;
  warnings: string[];
  lifetimeFromThisMachine: PersistedCallTally | null;
  lifetimeSummary: string;
  note: string;
};

const BUDGET_NOTE =
  `Onshape pools its annual allowance company-wide (${ONSHAPE_LIMITS_URL}); this ledger only knows the calls Vantage made from this machine. Onshape's own usage page is the authoritative number.`;

function budgetView(
  summary: CallBudgetSummary | null,
  tally: PersistedCallTally | undefined,
  auth: { authPath: string; countsAgainstAnnualCap: boolean } | null,
  /** Replaces the "runs entirely offline" line when 0 calls is true but offline is not why. */
  headlineWithoutSummary?: string,
): ToolBudgetView {
  return {
    authPath: auth?.authPath ?? null,
    countsAgainstAnnualCap: auth?.countsAgainstAnnualCap ?? false,
    callsThisTool: summary?.total ?? 0,
    chargedToAnnualCapThisTool: summary?.annualCapCalls ?? 0,
    headline:
      summary?.headline ?? headlineWithoutSummary ?? "0 Onshape calls — this tool runs entirely offline.",
    warnings: summary?.warnings ?? [],
    lifetimeFromThisMachine: tally ?? null,
    lifetimeSummary: describeCallTally(tally),
    note: BUDGET_NOTE,
  };
}

/** Errors that carry the ledger, so even a failure says what it spent. */
class CadPartToolError extends Error {
  readonly budget: ToolBudgetView | null;
  constructor(message: string, budget: ToolBudgetView | null) {
    super(budget ? `${message} [${budget.headline}]` : message);
    this.name = "CadPartToolError";
    this.budget = budget;
  }
}

// ---------------------------------------------------------------------------
// Auth + call accounting
// ---------------------------------------------------------------------------

type OnshapeContext = {
  auth: OnshapeAuthResolution;
  http: OnshapeHttpFn;
  budget: CallBudget;
};

async function openOnshape(runtime: CadPartRuntime): Promise<OnshapeContext> {
  const now = runtime.now;
  const budget = createCallBudget(now ? { now } : {});
  const resolve = runtime.resolveAuth ?? resolveOnshapeAuth;
  const auth = await resolve({ budget, env: runtimeEnv(runtime), ...(now ? { now } : {}) });
  return { auth, http: auth.http, budget };
}

/**
 * Fold this tool's calls into the lifetime tally and persist once. Called with
 * whatever other session changes the tool made, so a tool never writes twice.
 *
 * A tool that neither spent a call nor changed the binding writes nothing —
 * a status query should not create files in someone's home directory.
 */
async function commit(
  runtime: CadPartRuntime,
  session: ClaudeCadSession,
  context: OnshapeContext | null,
  mutated = false,
): Promise<{ session: ClaudeCadSession; budget: ToolBudgetView }> {
  const summary = context ? context.budget.summary() : null;
  const next = summary && summary.total > 0 ? noteSessionCalls(session, summary) : session;
  if (mutated || next !== session) await saveSession(runtime, next);
  return {
    session: next,
    budget: budgetView(
      summary,
      next.calls,
      context ? { authPath: context.auth.authPath, countsAgainstAnnualCap: context.auth.countsAgainstAnnualCap } : null,
    ),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

function onshapeFailure(what: string, status: number, body: unknown): Error {
  const message =
    (body as { message?: string } | null)?.message ??
    (typeof body === "string" ? body : JSON.stringify(body ?? {}).slice(0, 300));
  return new Error(`Onshape refused to ${what} (HTTP ${status}): ${String(message).slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

type BoundDocument = { documentId: string; workspaceId: string; elementId: string };

function bindingKey(document: { documentId: string; workspaceId: string }): string {
  return `${document.documentId}/${document.workspaceId}`;
}

function boundDocument(session: ClaudeCadSession): BoundDocument | null {
  if (!session.documentId || !session.workspaceId || !session.elementId) return null;
  return { documentId: session.documentId, workspaceId: session.workspaceId, elementId: session.elementId };
}

// ---------------------------------------------------------------------------
// Hole intent -> modelled diameter
// ---------------------------------------------------------------------------

const HOLE_SCHEMA_FIELDS = ["id", "diameterMm", "through", "depthMm", "counterbore", "pattern"] as const;

/**
 * Turn the hole INTENT an agent can express ("M3, clearance") into the modelled
 * geometry the generator needs, or say exactly what is missing.
 *
 * The three hole types are three different diameters for the same fastener —
 * M3 is 3.4 mm clearance (ISO 273 normal), 2.5 mm tapped (major diameter minus
 * coarse pitch) and 4.0 mm for a heat-set insert — so a missing holeType is a
 * question, never a default.
 */
function resolveHoles(
  rawPart: Json,
  clarifications: Clarification[],
  defaults: AppliedDefault[],
  notes: string[],
): Json {
  const holes = list(rawPart.holes);
  if (!holes.length) return rawPart;

  const resolved = holes.map((raw, index) => {
    const hole = record(raw);
    const id = str(hole.id) || `holes[${index}]`;
    const out: Json = {};
    for (const field of HOLE_SCHEMA_FIELDS) {
      if (hole[field] !== undefined) out[field] = hole[field];
    }

    const explicit = optionalNumber(hole.diameterMm);
    const thread = str(hole.thread);
    const holeType = str(hole.holeType);

    if (explicit !== undefined && explicit > 0) {
      if (thread && !holeType) {
        notes.push(
          `Hole "${id}" gave both diameterMm and thread ${thread}; the explicit ${explicit} mm was used and the thread was only a label.`,
        );
      }
      return out;
    }

    if (!thread) {
      clarifications.push({
        field: `holes[${index}].diameterMm`,
        question: `What size is hole "${id}"? Give diameterMm (the size the printed hole should end up), or thread + holeType.`,
        options: ["diameterMm: <number>", "thread: M2 | M2.5 | M3 | M4 | M5 | M6 | M8, with holeType"],
        why: "A hole with no diameter cannot be modelled, and guessing one produces a part that has to be reprinted.",
      });
      return out;
    }

    if (!isMetricThread(thread)) {
      clarifications.push({
        field: `holes[${index}].thread`,
        question: `"${thread}" is not a thread size this tool has tables for. Which one is hole "${id}"?`,
        options: ["M2", "M2.5", "M3", "M4", "M5", "M6", "M8"],
        why: "Clearance, tap-drill and insert-bore diameters are looked up per thread size; nothing is interpolated.",
      });
      return out;
    }

    if (!holeType) {
      const insertId = defaultInsertIdForThread(thread);
      const insertBore = insertId ? requireInsert(insertId).boreDiameterMm : null;
      clarifications.push({
        field: `holes[${index}].holeType`,
        question: `Is hole "${id}" (${thread}) a bolt clearance hole, a tapped hole, or a heat-set insert bore?`,
        options: [
          `clearance — ${clearanceHoleMm(thread)} mm (ISO 273 normal series)`,
          `tapped — ${tapDrillMm(thread)} mm tap drill (major diameter minus coarse pitch)`,
          insertBore === null
            ? "heat-set — no insert is tabulated for this thread"
            : `heat-set — ${insertBore} mm installation hole (${insertId})`,
        ],
        why: `The same ${thread} is three different diameters depending on which of these it is.`,
      });
      return out;
    }

    if (holeType === "clearance") {
      const requestedFit = str(hole.fit);
      const fit = requestedFit === "close" || requestedFit === "loose" ? requestedFit : "normal";
      if (!requestedFit) {
        defaults.push({
          field: `holes[${index}].fit`,
          value: "normal",
          source: `ISO 273 medium/normal series — the general-purpose fit. ${thread} normal is ${clearanceHoleMm(thread, "normal")} mm; close is ${clearanceHoleMm(thread, "close")} mm and loose is ${clearanceHoleMm(thread, "loose")} mm.`,
        });
      } else if (requestedFit !== "close" && requestedFit !== "normal" && requestedFit !== "loose") {
        clarifications.push({
          field: `holes[${index}].fit`,
          question: `"${requestedFit}" is not an ISO 273 fit series.`,
          options: ["close", "normal", "loose"],
          why: "The three series differ by a few tenths of a millimetre and that is the whole point of asking.",
        });
        return out;
      }
      out.diameterMm = clearanceHoleMm(thread, fit);
      return out;
    }

    if (holeType === "tapped") {
      out.diameterMm = tapDrillMm(thread);
      notes.push(
        `Hole "${id}" is the ${thread} tap drill (${out.diameterMm} mm). Cutting a thread straight into FDM plastic is weaker than a heat-set insert; for anything structural model a boss with an insert instead.`,
      );
      return out;
    }

    if (holeType === "heat-set") {
      const requested = str(hole.insert);
      const insertId = requested || defaultInsertIdForThread(thread);
      if (!insertId) {
        clarifications.push({
          field: `holes[${index}].insert`,
          question: `No heat-set insert is tabulated for ${thread}. Give hole "${id}" an explicit diameterMm from your insert's datasheet.`,
          why: "Insert geometry differs between brands and this tool will not interpolate one.",
        });
        return out;
      }
      const insert = requireInsert(insertId);
      out.diameterMm = insert.boreDiameterMm;
      if (!requested) {
        defaults.push({
          field: `holes[${index}].insert`,
          value: insert.id,
          source: `Longest tabulated ${thread} body, the usual structural choice. Installation hole ${insert.boreDiameterMm} mm, needs ${requiredBoreDepthMm(insert)} mm of bore depth.`,
        });
      }
      if (hole.through === undefined) {
        out.through = false;
        defaults.push({
          field: `holes[${index}].through`,
          value: "false",
          source: "A heat-set insert seats in a blind bore; a through hole gives the displaced plastic nowhere to go.",
        });
      }
      if (optionalNumber(hole.depthMm) === undefined && out.through === false) {
        out.depthMm = requiredBoreDepthMm(insert);
        defaults.push({
          field: `holes[${index}].depthMm`,
          value: String(requiredBoreDepthMm(insert)),
          source: `SPIROL minimum: insert length plus two thread pitches (${insert.lengthMm} mm + 2 x pitch).`,
        });
      }
      notes.push(
        `Hole "${id}" is modelled as a plain bore. The insert-depth and boss-wall rules only run on a part's \`bosses\`, so model the insert as a boss when you want those checked.`,
      );
      return out;
    }

    clarifications.push({
      field: `holes[${index}].holeType`,
      question: `"${holeType}" is not a hole type this tool knows.`,
      options: ["clearance", "tapped", "heat-set"],
      why: "Each maps to a different diameter table.",
    });
    return out;
  });

  return { ...rawPart, holes: resolved };
}

function resolvePartInput(
  rawPart: unknown,
  clarifications: Clarification[],
  defaults: AppliedDefault[],
  notes: string[],
): ModelledPart {
  const part = record(rawPart);
  if (!str(part.name)) {
    clarifications.push({
      field: "part.name",
      question: "What should this part be called? It becomes the feature name in the Onshape tree.",
      why: "An unnamed feature is unfindable in a feature tree a week later.",
    });
  }
  if (!record(part.base).kind) {
    clarifications.push({
      field: "part.base.kind",
      question: "What is the base shape?",
      options: ["plate (width x depth x thickness)", "box (width x depth x height, optionally hollow)", "bracket (an L)"],
      why: "Every other dimension is measured from the base, so it cannot be inferred.",
    });
  }
  return resolveHoles(part, clarifications, defaults, notes) as unknown as ModelledPart;
}

function printerClarification(printerId: string): Clarification | null {
  if (!printerId) {
    return {
      field: "printerId",
      question: "Which printer is this part for?",
      options: PRINTER_PROFILES.map((printer) => `${printer.id} — ${printer.brand} ${printer.model}`),
      why: "Bed size, nozzle material and bead width all change the answer, and a wrong machine means a failed print.",
    };
  }
  if (findPrinter(printerId)) return null;
  return {
    field: "printerId",
    question: `"${printerId}" is not a printer profile this build has specifications for. Which of these is it?`,
    options: PRINTER_PROFILES.map((printer) => `${printer.id} — ${printer.brand} ${printer.model}`),
    why: "Every profile's build volume and temperatures were read off the manufacturer's published specification; nothing is guessed for an unknown machine.",
  };
}

function materialClarification(materialId: string): Clarification | null {
  if (!materialId) {
    return {
      field: "materialId",
      question: "Which filament?",
      options: MATERIAL_PROFILES.map((material) => `${material.id} — ${material.name}`),
      why: "Enclosure requirement, nozzle abrasion and shrinkage all follow from the material.",
    };
  }
  if (findMaterial(materialId)) return null;
  return {
    field: "materialId",
    question: `"${materialId}" is not a material profile this build knows.`,
    options: MATERIAL_PROFILES.map((material) => `${material.id} — ${material.name}`),
    why: "The compensation model needs the material's shrinkage and squish figures.",
  };
}

// ---------------------------------------------------------------------------
// Flow enforcement
// ---------------------------------------------------------------------------

const PRECONDITION_FIX: Record<CadPartToolPrecondition, string> = {
  auth: "Run `vantage-cad login` to sign into Onshape in a browser window, then call cad_auth_status.",
  binding: "Call cad_open_document with the Onshape Part Studio URL.",
  check: "Call cad_part_check with the part, a printerId and a materialId.",
  preview: "Call cad_part_preview with the checkToken from cad_part_check.",
  push: "Call cad_part_push with the previewToken from cad_part_preview.",
};

function outOfOrder(tool: string, missing: CadPartToolPrecondition, detail: string): Json {
  const spec = cadPartToolSpec(tool);
  return {
    tool,
    status: "out_of_order",
    missing,
    error: detail,
    fix: PRECONDITION_FIX[missing],
    canonicalFlow: CAD_PART_TOOL_CATALOG.map((entry) => entry.name),
    why: "The order is enforced, not advisory: it is what keeps a part from costing more Onshape calls than it has to.",
    onshapeCallsMade: 0,
    ...(spec ? { toolCost: spec.onshapeCalls } : {}),
  };
}

type OnshapeSetupError = OnshapeAuthUnavailableError | OnshapeSessionExpiredError;

/**
 * Onshape not being connected — never signed in, or a saved session Onshape has
 * since rejected — is a setup state, not a crash.
 *
 * Only these two typed errors are converted. A CadPartToolError is deliberately
 * left to throw: it already carries what a partly-completed push managed to do
 * before it failed, and restating that as "sign in again" would discard it.
 */
function isOnshapeSetupError(error: unknown): error is OnshapeSetupError {
  return error instanceof OnshapeAuthUnavailableError || error instanceof OnshapeSessionExpiredError;
}

function setupRequired(tool: string, error: OnshapeSetupError, tally: PersistedCallTally | undefined): Json {
  const expired = error instanceof OnshapeSessionExpiredError;
  return {
    tool,
    status: "setup_required",
    missing: "auth" satisfies CadPartToolPrecondition,
    reason: error.code,
    error: error.message,
    fix: PRECONDITION_FIX.auth,
    onshapeCallsMade: 0,
    // True on both paths, and for the same published rule: an unresolved
    // credential never reaches Onshape, and a rejected one answers 4xx. Onshape
    // charges a counted path only on 2xx/3xx.
    // https://onshape-public.github.io/docs/auth/limits/ (verified 2026-08-25)
    callBudget: budgetView(
      null,
      tally,
      null,
      expired
        ? "0 calls charged to the Onshape annual cap — Onshape rejected the saved session, and a 4xx response is never counted."
        : "0 Onshape calls — no credential was resolved, so nothing left this machine.",
    ),
  };
}

function needsClarification(tool: string, clarifications: Clarification[], defaults: AppliedDefault[]): Json {
  return {
    tool,
    status: "needs_clarification",
    missing: clarifications,
    defaultsApplied: defaults,
    onshapeCallsMade: 0,
    fix: "Ask the user these exact questions, then call this tool again with the answers. Nothing was built and no Onshape call was spent.",
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

async function toolAuthStatus(args: Json, runtime: CadPartRuntime): Promise<Json> {
  const verify = bool(args.verify);
  const env = runtimeEnv(runtime);
  const saved = await loadOnshapeBrowserSession(env).catch(() => null);
  const browserSession = onshapeSessionStatus(saved, runtime.now ? runtime.now() : Date.now());
  let session = await loadSession(runtime);

  let context: OnshapeContext | null = null;
  let resolutionError: string | null = null;
  try {
    context = await openOnshape(runtime);
  } catch (error) {
    resolutionError = error instanceof Error ? error.message : ONSHAPE_AUTH_SETUP_MESSAGE;
  }

  let identity: { id: string; name?: string } | null = null;
  let probeError: string | null = null;
  if (context && verify) {
    try {
      identity = await probeOnshapeIdentity(context.http);
    } catch (error) {
      probeError = error instanceof Error ? error.message : "The saved credential was rejected.";
    }
  }

  const committed = await commit(runtime, session, context);
  session = committed.session;

  return {
    tool: "cad_auth_status",
    status: context ? "ok" : "setup_required",
    connected: Boolean(context),
    authPath: context?.auth.authPath ?? null,
    countsAgainstAnnualCap: context?.auth.countsAgainstAnnualCap ?? false,
    baseUrl: context?.auth.baseUrl ?? null,
    message: context?.auth.label ?? resolutionError ?? ONSHAPE_AUTH_SETUP_MESSAGE,
    ...(context?.auth.warning ? { warning: context.auth.warning } : {}),
    browserSession: {
      connected: browserSession.connected,
      message: browserSession.message,
      accountLabel: browserSession.accountLabel,
      expiresAt: browserSession.expiresAt,
      cookieCount: browserSession.cookieCount,
    },
    ...(verify ? { verified: Boolean(identity), identity, ...(probeError ? { probeError } : {}) } : {}),
    binding: summarizeClaudeCadSession(session),
    annualAllowance: {
      limitsByPlan: ONSHAPE_ANNUAL_CALL_LIMITS,
      source: ONSHAPE_LIMITS_URL,
      note: "Browser-session calls are not deducted. API-key and non-App-Store OAuth calls are, and only when they return 2xx/3xx.",
    },
    callBudget: committed.budget,
    nextStep: context
      ? "cad_open_document with the Onshape Part Studio URL."
      : "Run `vantage-cad login`, then call cad_auth_status again.",
  };
}

type OnshapeElement = { id: string; name: string; elementType: string };

function parseElements(body: unknown): OnshapeElement[] {
  const items = Array.isArray(body) ? body : list((body as { items?: unknown } | null)?.items);
  return items.map((raw) => {
    const item = record(raw);
    return {
      id: str(item.id),
      name: str(item.name) || "Element",
      elementType: str(item.elementType) || str(item.type),
    };
  });
}

function isPartStudio(element: OnshapeElement): boolean {
  return /partstudio/i.test(element.elementType);
}

function isFeatureStudio(element: OnshapeElement): boolean {
  return /featurestudio/i.test(element.elementType);
}

async function toolOpenDocument(args: Json, runtime: CadPartRuntime): Promise<Json> {
  const url = str(args.url);
  let documentId = str(args.documentId);
  let workspaceId = str(args.workspaceId);
  let elementId = str(args.elementId);

  if (url) {
    const parsed = parseOnshapeDocumentUrl(url);
    documentId = documentId || parsed.documentId;
    workspaceId = workspaceId || parsed.workspaceId;
    elementId = elementId || parsed.elementId;
  }

  const clarifications: Clarification[] = [];
  if (!documentId) {
    clarifications.push({
      field: "url",
      question: "Which Onshape document? Paste the Part Studio tab's URL.",
      options: ["https://cad.onshape.com/documents/<documentId>/w/<workspaceId>/e/<elementId>"],
      why: "Nothing can be bound without a document id, and a disposable document is the right place to start.",
    });
  } else if (!workspaceId) {
    clarifications.push({
      field: "workspaceId",
      question:
        "That URL has no workspace id. Open the document in Onshape, click the Part Studio tab, and paste that link — it contains /w/<workspace>/e/<element>.",
      why: "Looking the default workspace up would cost an Onshape call, and the link you already have carries it for free.",
    });
  }
  if (clarifications.length) return needsClarification("cad_open_document", clarifications, []);

  const context = await openOnshape(runtime);
  let session = await loadSession(runtime);

  const response = await context.http(`/documents/d/${documentId}/w/${workspaceId}/elements`);
  const body = await readJson(response);
  if (!response.ok) {
    const committed = await commit(runtime, session, context);
    throw new CadPartToolError(
      onshapeFailure("list the elements of that document", response.status, body).message,
      committed.budget,
    );
  }
  const elements = parseElements(body);
  const partStudios = elements.filter(isPartStudio);

  let target = elementId ? elements.find((element) => element.id === elementId) : undefined;
  if (elementId && !target) {
    const committed = await commit(runtime, session, context);
    return {
      tool: "cad_open_document",
      status: "needs_clarification",
      missing: [
        {
          field: "elementId",
          question: `Element ${elementId} is not in that workspace. Which tab did you mean?`,
          options: elements.map((element) => `${element.id} — ${element.name} (${element.elementType})`),
          why: "Binding to an element that is not there would fail on the first build call, after it was already spent.",
        },
      ],
      defaultsApplied: [],
      callBudget: committed.budget,
    };
  }
  if (!target) {
    if (partStudios.length === 1) target = partStudios[0];
    else {
      const committed = await commit(runtime, session, context);
      return {
        tool: "cad_open_document",
        status: "needs_clarification",
        missing: [
          {
            field: "elementId",
            question: partStudios.length
              ? "That document has more than one Part Studio. Which one should this session edit?"
              : "That workspace has no Part Studio. Create one in Onshape, then paste its tab URL.",
            options: partStudios.map((element) => `${element.id} — ${element.name}`),
            why: "Picking a Part Studio for you is exactly the kind of guess that ends up building into the wrong tab.",
          },
        ],
        defaultsApplied: [],
        callBudget: committed.budget,
      };
    }
  }
  if (target && !isPartStudio(target)) {
    const committed = await commit(runtime, session, context);
    throw new CadPartToolError(
      `Element ${target.id} is a ${target.elementType || "non-Part-Studio"} tab ("${target.name}"). Part features can only be inserted into a Part Studio.`,
      committed.budget,
    );
  }

  const partStudio = target!;
  const featureStudios = elements.filter(isFeatureStudio);
  const requestedStudio = str(args.featureStudioElementId);
  const featureStudio =
    (requestedStudio ? featureStudios.find((element) => element.id === requestedStudio) : undefined) ??
    featureStudios.find((element) => /vantage/i.test(element.name)) ??
    (featureStudios.length === 1 ? featureStudios[0] : undefined);

  const bound = bindClaudeCadSession(
    session,
    {
      documentId,
      workspaceId,
      elementId: partStudio.id,
      elementName: partStudio.name,
      url: onshapeDocumentOpenUrl({ documentId, workspaceId, elementId: partStudio.id }),
    },
    new Date(runtime.now ? runtime.now() : Date.now()).toISOString(),
  );
  const key = bindingKey({ documentId, workspaceId });
  if (featureStudio) featureStudioByBinding.set(key, featureStudio.id);
  else featureStudioByBinding.delete(key);

  const committed = await commit(runtime, bound, context, true);
  session = committed.session;

  return {
    tool: "cad_open_document",
    status: "ok",
    resumed: (session.features ?? []).length > 0,
    bound: {
      documentId,
      workspaceId,
      elementId: partStudio.id,
      partStudioName: partStudio.name,
      url: session.url ?? null,
    },
    featureStudio: featureStudio
      ? { elementId: featureStudio.id, name: featureStudio.name }
      : null,
    featureStudioNote: featureStudio
      ? "Generated FeatureScript will be written into this tab."
      : "This document has no Feature Studio yet. cad_part_push will say how to add one — Onshape does not publish a create-Feature-Studio endpoint, so Vantage will not silently invent one.",
    elements: elements.map((element) => ({ id: element.id, name: element.name, elementType: element.elementType })),
    featuresFromPreviousSessions: (session.features ?? []).length,
    callBudget: committed.budget,
    nextStep: "cad_part_check with the part, a printerId and a materialId. It costs 0 Onshape calls.",
  };
}

async function toolPartStudioContents(_args: Json, runtime: CadPartRuntime): Promise<Json> {
  const session = await loadSession(runtime);
  const document = boundDocument(session);
  if (!document) return outOfOrder("cad_part_studio_contents", "binding", "No Part Studio is bound.");

  const context = await openOnshape(runtime);
  const response = await context.http(onshapeFeaturePath(document));
  const body = await readJson(response);
  if (!response.ok) {
    const committed = await commit(runtime, session, context);
    throw new CadPartToolError(
      onshapeFailure("read the feature list", response.status, body).message,
      committed.budget,
    );
  }

  const raw = list((body as { features?: unknown } | null)?.features);
  const features: OnshapeFeatureSummary[] = raw.map((entry) => {
    const feature = record(entry);
    const message = record(feature.message);
    return {
      id: str(message.featureId) || str(feature.featureId) || str(feature.nodeId),
      name: str(message.name) || str(feature.name) || "Feature",
      featureType: str(message.featureType) || str(feature.featureType) || "unknown",
      suppressed: Boolean(message.suppressed ?? feature.suppressed ?? false),
    };
  });

  const owned = new Map((session.features ?? []).map((feature) => [feature.featureId, feature]));
  const editable = (session.features ?? [])
    .filter((feature) => typeof feature.parameters?.[META.featureType] === "string")
    .map((feature) => ({
      featureId: feature.featureId,
      name: feature.name,
      featureType: String(feature.parameters?.[META.featureType]),
      parameters: Object.fromEntries(
        Object.entries(feature.parameters ?? {}).filter(([key]) => !key.startsWith("vantage.")),
      ),
      stillInThisPartStudio: features.some((entry) => entry.id === feature.featureId),
    }));

  const committed = await commit(runtime, session, context);

  return {
    tool: "cad_part_studio_contents",
    status: "ok",
    features: features.map((feature) => ({
      ...feature,
      addedByVantage: owned.has(feature.id),
    })),
    explain: explainFeatureTreeForStudents(features),
    editableParts: editable,
    callBudget: committed.budget,
    nextStep: editable.length
      ? "cad_part_edit to change a dimension on an existing part (1 call), or cad_part_check to start a new one (0 calls)."
      : "cad_part_check with the part, a printerId and a materialId. It costs 0 Onshape calls.",
  };
}

function summariseReport(report: DfmReport) {
  return {
    status: report.status,
    summary: report.summary,
    findings: report.findings,
    bedFit: report.bedFit,
    modelledDimensions: report.modelledDimensions,
    notApplicable: report.notApplicable,
    usesUnverifiedProfile: report.usesUnverifiedProfile,
    nozzleDiameterMm: report.nozzleDiameterMm,
    extrusionWidthMm: report.extrusionWidthMm,
  };
}

/** No `runtime`: the whole DFM pass is offline, so there is nothing to resolve or spend. */
async function toolPartCheck(args: Json, _runtime: CadPartRuntime): Promise<Json> {
  const clarifications: Clarification[] = [];
  const defaults: AppliedDefault[] = [];
  const notes: string[] = [];

  const printerId = str(args.printerId);
  const materialId = str(args.materialId);
  const printerQuestion = printerClarification(printerId);
  if (printerQuestion) clarifications.push(printerQuestion);
  const materialQuestion = materialClarification(materialId);
  if (materialQuestion) clarifications.push(materialQuestion);

  const part = resolvePartInput(args.part, clarifications, defaults, notes);
  if (clarifications.length) return needsClarification("cad_part_check", clarifications, defaults);

  const input: CheckPartInput = {
    part,
    printerId,
    materialId,
    ...(args.inserts ? { inserts: record(args.inserts) as Record<string, string> } : {}),
    ...(Array.isArray(args.overhangs) ? { overhangs: args.overhangs as CheckPartInput["overhangs"] } : {}),
    ...(Array.isArray(args.smallFeatures) ? { smallFeatures: args.smallFeatures as CheckPartInput["smallFeatures"] } : {}),
  };

  const report = checkPart(input);
  const compensated = applyDfmCompensation(part, report);
  // Every input that can move a finding is in the token, so a token can never
  // address a report that was run on different inputs.
  const token = tokenFor("check", {
    part,
    printerId,
    materialId,
    inserts: input.inserts ?? null,
    overhangs: input.overhangs ?? null,
    smallFeatures: input.smallFeatures ?? null,
  });
  remember(checkedParts, token, { token, part, compensated, report, printerId, materialId });

  const printer = findPrinter(printerId)!;
  const material = findMaterial(materialId)!;

  return {
    tool: "cad_part_check",
    status: "ok",
    checkToken: token,
    onshapeCallsMade: 0,
    dfm: summariseReport(report),
    report: describeDfmReport(report),
    /** The part with every compensated diameter written in — this is what gets built. */
    compensatedPart: compensated,
    defaultsApplied: defaults,
    notes,
    printer: {
      id: printer.id,
      label: `${printer.brand} ${printer.model}`,
      buildVolumeMm: printer.buildVolumeMm,
      nozzleDiameterMm: printer.nozzleDiameterMm,
      specVerified: printer.specVerified,
      sources: printer.sources,
    },
    material: {
      id: material.id,
      name: material.name,
      shrinkageVerified: material.shrinkageVerified,
      holeCompensationCalibrated: material.holeCompensationCalibrated,
      notes: material.notes,
    },
    callBudget: budgetView(null, undefined, null),
    nextStep:
      report.status === "fail"
        ? "Fix the failing findings and run cad_part_check again. cad_part_push refuses a failing part unless every failing check is acknowledged by name."
        : `cad_part_preview with checkToken="${token}". Still 0 Onshape calls.`,
  };
}

async function toolPartPreview(args: Json, runtime: CadPartRuntime): Promise<Json> {
  const checkToken = str(args.checkToken);
  const clarifications: Clarification[] = [];
  const defaults: AppliedDefault[] = [];
  const notes: string[] = [];

  let part: ModelledPart;
  let checked: CheckedPart | undefined;
  if (checkToken) {
    checked = checkedParts.get(checkToken);
    if (!checked) {
      return outOfOrder(
        "cad_part_preview",
        "check",
        `checkToken "${checkToken}" is not one this process issued. Check tokens live in memory, so a restarted session has to re-run cad_part_check — it costs 0 Onshape calls.`,
      );
    }
    part = checked.compensated;
  } else if (args.part) {
    part = resolvePartInput(args.part, clarifications, defaults, notes);
    if (clarifications.length) return needsClarification("cad_part_preview", clarifications, defaults);
  } else {
    return outOfOrder("cad_part_preview", "check", "Pass either a checkToken from cad_part_check or a raw part.");
  }

  const session = await loadSession(runtime);
  const document = boundDocument(session);
  const knownFeatureStudio = document ? featureStudioByBinding.get(bindingKey(document)) : undefined;

  const version = optionalNumber(args.featureScriptVersion);
  const preview = dryRunPart(part, {
    freshDocument: !knownFeatureStudio,
    ...(version === undefined ? {} : { featureScriptVersion: version }),
  });
  const token = tokenFor("preview", { part, version: preview.featureScriptVersion });
  remember(previewedParts, token, {
    token,
    checkToken: checked?.token ?? null,
    part,
    generated: preview,
    preview,
  });

  return {
    tool: "cad_part_preview",
    status: "ok",
    previewToken: token,
    onshapeCallsMade: 0,
    checked: Boolean(checked),
    ...(checked
      ? { dfmStatus: checked.report.status, printerId: checked.printerId, materialId: checked.materialId }
      : {
          warning:
            "This preview was generated from a raw part, so no printer, material or DFM check is attached to it. cad_part_push refuses an unchecked preview.",
        }),
    feature: {
      featureTypeName: preview.featureTypeName,
      featureTypeId: preview.featureTypeId,
      featureScriptVersion: preview.featureScriptVersion,
      sourceCharacters: preview.sourceBudget.used,
      sourceLimit: preview.sourceBudget.limit,
      parameterCount: preview.parameters.length,
    },
    geometry: preview.geometry,
    parameters: preview.parameters.map((parameter) => ({
      parameterId: parameter.parameterId,
      label: parameter.label,
      kind: parameter.kind,
      value: parameter.value,
      expression: parameter.expression,
      minimum: parameter.minimum,
      maximum: parameter.maximum,
    })),
    warnings: preview.warnings,
    callPlan: preview.callPlan,
    // estimateOnshapeCalls always budgets a separate GET for the Feature Studio
    // microversion. cad_part_push only spends it when Onshape's write response
    // does not carry one, so the plan is an upper bound; the push result says
    // which happened in `microversionSource`.
    callPlanNote:
      "This plan is an upper bound: it budgets a separate read for the Feature Studio microversion, which cad_part_push skips whenever Onshape's write response already carries it.",
    summary: describePartPreview(preview),
    defaultsApplied: defaults,
    notes,
    ...(bool(args.includeSource) ? { source: preview.source } : {}),
    callBudget: budgetView(null, undefined, null),
    nextStep: checked
      ? `cad_part_push with previewToken="${token}" — ${preview.callPlan.total} Onshape calls including verification.`
      : "Run cad_part_check on this part first; cad_part_push will not accept an unchecked preview.",
  };
}

function parameterPayload(generated: GeneratedPartFeature) {
  return generated.parameters.map((parameter) => ({
    parameterId: parameter.parameterId,
    kind: parameter.kind,
    value: parameter.value,
  }));
}

function metaParameters(input: {
  generated: GeneratedPartFeature;
  namespace: string;
  featureStudioElementId: string;
  previewToken: string;
  printerId: string | null;
  materialId: string | null;
  definition: ModelledPart;
}): CadSessionParameters {
  const numeric: CadSessionParameters = {};
  for (const parameter of input.generated.parameters) numeric[parameter.parameterId] = parameter.value;
  const definitionJson = JSON.stringify(input.definition);
  return {
    ...numeric,
    [META.featureType]: input.generated.featureTypeId,
    [META.namespace]: input.namespace,
    [META.featureStudio]: input.featureStudioElementId,
    [META.previewToken]: input.previewToken,
    ...(input.printerId ? { [META.printerId]: input.printerId } : {}),
    ...(input.materialId ? { [META.materialId]: input.materialId } : {}),
    ...(definitionJson.length <= DEFINITION_STORE_LIMIT ? { [META.definition]: definitionJson } : {}),
  };
}

async function toolPartPush(args: Json, runtime: CadPartRuntime): Promise<Json> {
  const previewToken = str(args.previewToken);
  if (!previewToken) {
    return outOfOrder("cad_part_push", "preview", "previewToken is required — push only builds something you have previewed.");
  }
  const previewed = previewedParts.get(previewToken);
  if (!previewed) {
    return outOfOrder(
      "cad_part_push",
      "preview",
      `previewToken "${previewToken}" is not one this process issued. Re-run cad_part_check then cad_part_preview; both cost 0 Onshape calls.`,
    );
  }
  const checked = previewed.checkToken ? checkedParts.get(previewed.checkToken) : undefined;
  if (!checked) {
    return outOfOrder(
      "cad_part_push",
      "check",
      "That preview has no local DFM check behind it. Local checks run first, at zero Onshape calls, so a part is never built before it is checked.",
    );
  }

  if (checked.report.status === "fail") {
    const failing = checked.report.findings.filter((finding) => finding.severity === "fail");
    const acknowledged = new Set(list(args.acknowledgedChecks).map((entry) => String(entry)));
    const unacknowledged = failing.filter((finding) => !acknowledged.has(finding.check));
    if (!bool(args.acknowledgeDfmFail) || unacknowledged.length) {
      return {
        tool: "cad_part_push",
        status: "blocked",
        reason: "dfm_fail",
        onshapeCallsMade: 0,
        failing: failing.map((finding) => ({
          check: finding.check,
          feature: finding.feature,
          message: finding.message,
          fix: finding.fix,
        })),
        fix: "Change the part and re-run cad_part_check, or push knowingly with acknowledgeDfmFail=true and acknowledgedChecks naming every failing rule.",
        why: "A part that fails a local rule will not print correctly, and finding that out after the Onshape calls are spent helps nobody.",
      };
    }
  }

  let session = await loadSession(runtime);
  const document = boundDocument(session);
  if (!document) return outOfOrder("cad_part_push", "binding", "No Part Studio is bound.");

  const alreadyPushed = (session.features ?? []).find(
    (feature) => feature.parameters?.[META.previewToken] === previewToken,
  );
  if (alreadyPushed) {
    return {
      tool: "cad_part_push",
      status: "blocked",
      reason: "already_built",
      onshapeCallsMade: 0,
      featureId: alreadyPushed.featureId,
      fix: `This exact part is already feature ${alreadyPushed.featureId} in the bound Part Studio. Change a dimension with cad_part_edit (1 Onshape call), or preview a genuinely different part.`,
      why: "Re-pushing an unchanged part spends calls to produce a duplicate body.",
    };
  }

  const key = bindingKey(document);
  const requestedStudio = str(args.featureStudioElementId);
  const rememberedStudio = featureStudioByBinding.get(key);
  const fromSession = [...(session.features ?? [])]
    .reverse()
    .map((feature) => feature.parameters?.[META.featureStudio])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  let featureStudioElementId = requestedStudio || rememberedStudio || fromSession || "";

  const context = await openOnshape(runtime);
  const steps: string[] = [];
  let createdFeatureStudio = false;

  try {
    if (!featureStudioElementId) {
      if (!bool(args.allowCreateFeatureStudio)) {
        const committed = await commit(runtime, session, context);
        return {
          tool: "cad_part_push",
          status: "needs_clarification",
          missing: [
            {
              field: "featureStudioElementId",
              question:
                "This document has no Feature Studio for the generated FeatureScript. Add a Feature Studio tab in Onshape (+ -> Create Feature Studio) and run cad_open_document again, or re-run this tool with allowCreateFeatureStudio=true.",
              why: "Onshape does not publish a create-Feature-Studio REST endpoint. Vantage will attempt one only when you ask for it, and will label the result as using an unverified endpoint.",
            },
          ],
          defaultsApplied: [],
          callBudget: committed.budget,
        };
      }
      const created = await context.http(onshapeFeatureStudioPath(document), {
        method: "POST",
        body: JSON.stringify({ name: "Vantage" }),
      });
      const createdBody = await readJson(created);
      if (!created.ok) throw onshapeFailure("create a Feature Studio", created.status, createdBody);
      featureStudioElementId = str(record(createdBody).id);
      if (!featureStudioElementId) {
        throw new Error("Onshape accepted the Feature Studio creation but returned no element id, so there is nothing to write into.");
      }
      createdFeatureStudio = true;
      featureStudioByBinding.set(key, featureStudioElementId);
      steps.push("created a Feature Studio (endpoint not published by Onshape — unverified)");
    }

    const contentsPath = onshapeFeatureStudioPath(document, featureStudioElementId);
    const written = await context.http(contentsPath, {
      method: "POST",
      body: JSON.stringify(featureStudioContentsPayload({ source: previewed.generated.source })),
    });
    const writtenBody = await readJson(written);
    if (!written.ok) throw onshapeFailure("write the generated FeatureScript", written.status, writtenBody);
    steps.push("wrote the generated FeatureScript into the Feature Studio");

    let microversionId = "";
    let microversionSource = "write-response";
    try {
      microversionId = parseFeatureStudioMicroversion(writtenBody);
    } catch {
      // Onshape's write response does not always carry the microversion. Reading
      // it back is one extra call and is the only way to build the namespace.
      const reread = await context.http(contentsPath);
      const rereadBody = await readJson(reread);
      if (!reread.ok) throw onshapeFailure("read the Feature Studio microversion", reread.status, rereadBody);
      microversionId = parseFeatureStudioMicroversion(rereadBody);
      microversionSource = "extra-get";
      steps.push("read the Feature Studio microversion back (the write response did not carry it)");
    }

    const namespace = customFeatureNamespace({ elementId: featureStudioElementId, microversionId });
    const name = str(args.name) || previewed.generated.featureTypeName;
    const inserted = await context.http(onshapeFeaturePath(document), {
      method: "POST",
      body: JSON.stringify(
        customFeatureCall({
          featureType: previewed.generated.featureTypeId,
          namespace,
          name,
          parameters: parameterPayload(previewed.generated),
        }),
      ),
    });
    const insertedBody = await readJson(inserted);
    if (!inserted.ok) throw onshapeFailure("insert the part feature", inserted.status, insertedBody);
    const featureId = parseAddedFeatureId(insertedBody);
    steps.push("inserted the part as one custom feature");

    const withFeature = recordSessionFeature(session, {
      featureId,
      kind: "solid",
      tool: "cad_part_push",
      name,
      at: new Date(runtime.now ? runtime.now() : Date.now()).toISOString(),
      parameters: metaParameters({
        generated: previewed.generated,
        namespace,
        featureStudioElementId,
        previewToken,
        printerId: checked.printerId,
        materialId: checked.materialId,
        definition: previewed.part,
      }),
    });
    const committed = await commit(runtime, withFeature, context, true);
    session = committed.session;
    pushedFeatureIds = [...pushedFeatureIds.filter((id) => id !== featureId), featureId];

    return {
      tool: "cad_part_push",
      status: "ok",
      featureId,
      featureName: name,
      featureType: previewed.generated.featureTypeId,
      featureStudioElementId,
      namespace,
      microversionSource,
      createdFeatureStudio,
      ...(createdFeatureStudio
        ? {
            unverifiedEndpoint:
              "The Feature Studio was created through an endpoint Onshape does not publish. If it misbehaves, create the tab by hand in Onshape and pass featureStudioElementId.",
          }
        : {}),
      steps,
      holesBuilt: previewed.generated.geometry.holes.length,
      parametersEditable: previewed.generated.parameters.length,
      onshapeCallsMade: committed.budget.callsThisTool,
      callBudget: committed.budget,
      note: "The whole part is one feature, so this cost the same as an empty plate would have. A later dimension change is cad_part_edit — 1 call.",
      nextStep: "cad_part_verify — 2 calls, one bounding-box readback and one iso view.",
    };
  } catch (error) {
    const committed = await commit(runtime, session, context);
    const detail = error instanceof Error ? error.message : "The push failed.";
    throw new CadPartToolError(
      `${detail}${steps.length ? ` Completed before the failure: ${steps.join("; ")}. Nothing else was changed.` : " Nothing was changed."}`,
      committed.budget,
    );
  }
}

function definitionFor(parameters: CadSessionParameters | undefined): ModelledPart | null {
  const raw = parameters?.[META.definition];
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as ModelledPart;
  } catch {
    return null;
  }
}

async function toolPartEdit(args: Json, runtime: CadPartRuntime): Promise<Json> {
  const edits = list(args.edits)
    .map((raw) => {
      const edit = record(raw);
      const value = optionalNumber(edit.value);
      return { parameterId: str(edit.parameterId), value: value ?? Number.NaN };
    })
    .filter((edit) => edit.parameterId);
  if (!edits.length) {
    return needsClarification(
      "cad_part_edit",
      [
        {
          field: "edits",
          question: "Which parameter should change, and to what? e.g. [{\"parameterId\":\"baseThickness\",\"value\":8}].",
          why: "Parameter ids and their bounds come from cad_part_preview or cad_part_studio_contents.",
        },
      ],
      [],
    );
  }

  let session = await loadSession(runtime);
  const document = boundDocument(session);
  if (!document) return outOfOrder("cad_part_edit", "binding", "No Part Studio is bound.");

  const requestedId = str(args.featureId);
  const candidates = (session.features ?? []).filter(
    (feature) => typeof feature.parameters?.[META.featureType] === "string",
  );
  const target = requestedId
    ? findSessionFeature(session, requestedId)
    : [...candidates].reverse().find((feature) => pushedFeatureIds.includes(feature.featureId)) ??
      candidates[candidates.length - 1];

  if (!target) {
    return outOfOrder(
      "cad_part_edit",
      "push",
      requestedId
        ? `Feature ${requestedId} was not created by Vantage in this binding, so there are no recorded parameters to edit. Run cad_part_studio_contents to see what is here.`
        : "No generated part feature is recorded for this Part Studio.",
    );
  }

  const featureType = target.parameters?.[META.featureType];
  const namespace = target.parameters?.[META.namespace];
  if (typeof featureType !== "string" || typeof namespace !== "string") {
    return outOfOrder(
      "cad_part_edit",
      "push",
      `Feature ${target.featureId} is not a generated part feature (it was built by the per-operation tools), so it has no parameters to edit. Use the onshape_* tools on it, or build it with cad_part_push to make it editable.`,
    );
  }

  const definition = definitionFor(target.parameters);
  if (!definition) {
    return {
      tool: "cad_part_edit",
      status: "blocked",
      reason: "definition_unavailable",
      onshapeCallsMade: 0,
      featureId: target.featureId,
      fix: "This session no longer has the part definition behind that feature, so a parameter's bounds cannot be checked. Re-run cad_part_check and cad_part_preview for the part (0 calls), then edit the feature in Onshape, or push the corrected part.",
      why: "Sending a parameter value without knowing its bounds is how a feature ends up failing to regenerate.",
    };
  }

  const generated = generatePartFeatureScript(definition);
  const plan = planParameterEdit(generated, edits);
  if (plan.kind === "rebuild-required") {
    return {
      tool: "cad_part_edit",
      status: "rebuild_required",
      onshapeCallsMade: 0,
      reason: plan.reason,
      featureId: target.featureId,
      editableParameters: generated.parameters.map((parameter) => ({
        parameterId: parameter.parameterId,
        label: parameter.label,
        value: parameter.value,
        minimum: parameter.minimum,
        maximum: parameter.maximum,
      })),
      fix: "Change the part definition and go through cad_part_check -> cad_part_preview -> cad_part_push again. Nothing was spent finding this out.",
    };
  }

  // An edit that re-states a value the feature already has would otherwise spend
  // a full Onshape call writing an identical parameter — the easy way for an
  // agent re-asserting a dimension to burn the allowance a call at a time.
  // Expressions are compared rather than raw numbers because the expression is
  // what is actually sent, so two values that round to the same literal are the
  // same edit as far as Onshape is concerned.
  const currentExpressions = new Map(
    generated.parameters.map((parameter) => [parameter.parameterId, parameter.expression]),
  );
  const effective = plan.changed.filter((parameterId) => {
    const next = plan.parameters.find((parameter) => parameter.parameterId === parameterId);
    return Boolean(next) && currentExpressions.get(parameterId) !== next!.expression;
  });
  /** Same shape in both branches, so one parser reads either result. */
  const alreadyCorrect = plan.changed
    .filter((parameterId) => !effective.includes(parameterId))
    .map((parameterId) => ({
      parameterId,
      value: plan.parameters.find((parameter) => parameter.parameterId === parameterId)!.value,
      expression: currentExpressions.get(parameterId) ?? null,
    }));
  if (!effective.length) {
    return {
      tool: "cad_part_edit",
      status: "no_change",
      onshapeCallsMade: 0,
      featureId: target.featureId,
      alreadyCorrect,
      why: "Every parameter in this edit already holds the requested value, so writing it would spend an Onshape call to change nothing.",
      nextStep: "cad_part_verify if you want to confirm what is actually in the document, or edit a different parameter.",
      callBudget: budgetView(null, session.calls, null),
    };
  }

  const printerId = target.parameters?.[META.printerId];
  const materialId = target.parameters?.[META.materialId];
  const recheck = bool(args.recheck, true) && typeof printerId === "string" && typeof materialId === "string";
  let report: DfmReport | null = null;
  if (recheck) {
    report = checkPart({ part: plan.definition, printerId: String(printerId), materialId: String(materialId) });
    if (report.status === "fail") {
      return {
        tool: "cad_part_edit",
        status: "blocked",
        reason: "dfm_fail",
        onshapeCallsMade: 0,
        featureId: target.featureId,
        dfm: summariseReport(report),
        fix: "Pick a value that passes, or repeat with recheck=false to send it anyway. Nothing was spent.",
        why: "The edited part now fails a local rule, and the check costs nothing while the Onshape call does.",
      };
    }
  }

  const context = await openOnshape(runtime);
  try {
    const response = await context.http(onshapeFeaturePath(document, target.featureId), {
      method: "POST",
      body: JSON.stringify(
        customFeatureUpdateCall({
          featureId: target.featureId,
          featureType,
          namespace,
          name: target.name,
          parameters: plan.parameters.map((parameter) => ({
            parameterId: parameter.parameterId,
            kind: parameter.kind,
            value: parameter.value,
          })),
        }),
      ),
    });
    const body = await readJson(response);
    if (!response.ok) throw onshapeFailure("update the part feature", response.status, body);

    const changedValues: CadSessionParameters = {};
    for (const parameterId of effective) {
      const parameter = plan.parameters.find((entry) => entry.parameterId === parameterId);
      if (parameter) changedValues[parameterId] = parameter.value;
    }
    const definitionJson = JSON.stringify(plan.definition);
    const updated = updateSessionFeatureParameters(session, target.featureId, {
      ...changedValues,
      ...(definitionJson.length <= DEFINITION_STORE_LIMIT ? { [META.definition]: definitionJson } : {}),
    });
    const committed = await commit(runtime, updated, context, true);
    session = committed.session;

    return {
      tool: "cad_part_edit",
      status: "ok",
      featureId: target.featureId,
      changed: effective.map((parameterId) => {
        const parameter = plan.parameters.find((entry) => entry.parameterId === parameterId)!;
        return { parameterId, value: parameter.value, expression: parameter.expression };
      }),
      /** Requested but already at that value, so they moved nothing. */
      ...(alreadyCorrect.length ? { alreadyCorrect } : {}),
      /** The point of the parameter design: no regenerate, no re-insert, no lost references. */
      regenerated: false,
      featureStudioWrites: 0,
      featuresInserted: 0,
      onshapeCallsMade: committed.budget.callsThisTool,
      ...(report ? { dfm: summariseReport(report) } : { dfmRecheck: "skipped" }),
      callBudget: committed.budget,
      nextStep: "cad_part_verify to confirm the new size — 2 calls.",
    };
  } catch (error) {
    const committed = await commit(runtime, session, context);
    throw new CadPartToolError(
      error instanceof Error ? error.message : "The parameter update failed.",
      committed.budget,
    );
  }
}

function decodeShadedView(body: unknown): string | null {
  const images = record(body).images;
  if (typeof images === "string") return images;
  const first = list(images)[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object") {
    const nested = record(first);
    for (const value of Object.values(nested)) if (typeof value === "string" && value.length > 64) return value;
  }
  return null;
}

async function toolPartVerify(args: Json, runtime: CadPartRuntime): Promise<Json> {
  let session = await loadSession(runtime);
  const document = boundDocument(session);
  if (!document) return outOfOrder("cad_part_verify", "binding", "No Part Studio is bound.");

  const requestedId = str(args.featureId);
  const candidates = (session.features ?? []).filter(
    (feature) => typeof feature.parameters?.[META.featureType] === "string",
  );
  const target = requestedId
    ? findSessionFeature(session, requestedId)
    : [...candidates].reverse().find((feature) => pushedFeatureIds.includes(feature.featureId)) ??
      candidates[candidates.length - 1];
  if (!target) {
    return outOfOrder("cad_part_verify", "push", "No generated part feature is recorded for this Part Studio.");
  }

  const rebuild = session.rebuild ?? 0;
  const cached = verifiedFeatures.get(target.featureId);
  if (cached && cached.rebuild === rebuild) {
    return {
      ...cached.result,
      cached: true,
      onshapeCallsMade: 0,
      note: "Nothing has changed since this session verified that feature, so the previous readback is returned instead of paying for the same answer again.",
      callBudget: budgetView(null, session.calls, null),
    };
  }

  const imageMode = str(args.image) || "path";
  const context = await openOnshape(runtime);
  try {
    // Bounding box: one read-only FeatureScript evaluation.
    // POST /partstudios/d/{did}/w/{wid}/e/{eid}/featurescript is the documented
    // evaluation endpoint (https://onshape-public.github.io/docs/api-adv/fs/,
    // verified 2026-08-25). The six values come back in a fixed order, so this
    // collects the string leaves directly rather than going through
    // evaluateOnshapeQuery, which de-duplicates ids and would silently collapse
    // a square part's repeated coordinates.
    const script = boundingBoxScript(target.featureId);
    const response = await context.http(
      `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}/featurescript`,
      {
        method: "POST",
        body: JSON.stringify({ script, queries: [], serializationVersion: ONSHAPE_SERIALIZATION_VERSION }),
      },
    );
    const body = await readJson(response);
    if (!response.ok) throw onshapeFailure("evaluate the bounding-box readback", response.status, body);
    const values = collectFeatureScriptStrings(record(body).result);
    const measured = parseBoundingBoxReadback(values);

    const definition = definitionFor(target.parameters);
    const predicted = definition ? generatePartFeatureScript(definition).geometry.sizeMm : null;
    const drift = measured && predicted ? compareBoundingBox(predicted, measured) : null;

    let image: Json | null = null;
    if (imageMode !== "none") {
      const width = optionalNumber(args.widthPx);
      const height = optionalNumber(args.heightPx);
      const path = isoShadedViewPath(document, {
        ...(width === undefined ? {} : { widthPx: width }),
        ...(height === undefined ? {} : { heightPx: height }),
      });
      const viewResponse = await context.http(path);
      const viewBody = await readJson(viewResponse);
      if (!viewResponse.ok) throw onshapeFailure("render the iso view", viewResponse.status, viewBody);
      const base64 = decodeShadedView(viewBody);
      if (!base64) {
        image = {
          available: false,
          note: "Onshape returned the shaded view but no image field this build recognises, so nothing is claimed about it.",
        };
      } else if (imageMode === "base64") {
        image = { available: true, encoding: "base64", mimeType: "image/png", data: base64 };
      } else {
        const directory = runtime.viewDir ?? join(vantageCadHome(runtimeEnv(runtime)), "views");
        await mkdir(directory, { recursive: true });
        const file = join(directory, `${target.featureId}-${Date.now()}.png`);
        const bytes = Buffer.from(base64, "base64");
        await writeFile(file, bytes, { mode: 0o600 });
        image = { available: true, path: file, bytes: bytes.length, mimeType: "image/png" };
      }
    }

    const committed = await commit(runtime, session, context);
    session = committed.session;

    const result: Json = {
      tool: "cad_part_verify",
      status: "ok",
      featureId: target.featureId,
      boundingBoxMm: measured,
      predictedSizeMm: predicted,
      driftMm: drift,
      // An arithmetic comparison against the generator's own prediction, not a
      // manufacturing tolerance: 0 means Onshape built exactly the envelope the
      // preview described.
      matchesPrediction: drift ? drift.worstMm < 0.001 : null,
      ...(measured
        ? {}
        : {
            note: "Onshape returned no parseable bounding box — an empty Part Studio or a FeatureScript error. Nothing is asserted about the geometry.",
          }),
      isoView: image,
      onshapeCallsMade: committed.budget.callsThisTool,
      callBudget: committed.budget,
      nextStep: "cad_part_edit to change a dimension (1 call), or cad_part_check for the next part (0 calls).",
    };
    verifiedFeatures.set(target.featureId, { featureId: target.featureId, rebuild, result });
    return result;
  } catch (error) {
    const committed = await commit(runtime, session, context);
    throw new CadPartToolError(
      error instanceof Error ? error.message : "Verification failed.",
      committed.budget,
    );
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

type PartToolHandler = (args: Json, runtime: CadPartRuntime) => Promise<Json>;

const PART_TOOLS: Record<string, PartToolHandler> = {
  cad_auth_status: toolAuthStatus,
  cad_open_document: toolOpenDocument,
  cad_part_studio_contents: toolPartStudioContents,
  cad_part_check: toolPartCheck,
  cad_part_preview: toolPartPreview,
  cad_part_push: toolPartPush,
  cad_part_edit: toolPartEdit,
  cad_part_verify: toolPartVerify,
};

export function isCadPartTool(name: string): boolean {
  return Object.hasOwn(PART_TOOLS, name);
}

/** Every tool the terminal MCP server advertises: per-operation tools, then the pipeline. */
export function cadMcpToolList() {
  return [...CLAUDE_CAD_TOOLS, ...cadPartToolListEntries()];
}

/**
 * Run one part-pipeline tool. Refusals come back as a normal result with a
 * `status` an agent can branch on; only a genuine fault throws, and even then
 * the message carries what the attempt spent.
 *
 * "Onshape is not connected" is a refusal, not a fault, so it is translated here
 * rather than in each of the six tools that can hit it. Doing it centrally is
 * also what keeps the promise that EVERY result carries a call ledger.
 */
export async function callCadPartTool(
  name: string,
  args: Record<string, unknown> = {},
  runtime: CadPartRuntime = {},
): Promise<Json> {
  const handler = PART_TOOLS[name];
  if (!handler) {
    throw new Error(
      `Unknown part tool "${name}". The pipeline is: ${CAD_PART_TOOL_CATALOG.map((tool) => tool.name).join(" -> ")}.`,
    );
  }
  try {
    return await handler(args, runtime);
  } catch (error) {
    if (!isOnshapeSetupError(error)) throw error;
    // Read-only: the lifetime tally is reported, and a tool that never resolved
    // a credential has nothing new to add to it.
    const tally = await loadSession(runtime)
      .then((session) => session.calls)
      .catch(() => undefined);
    return setupRequired(name, error, tally);
  }
}

async function callAnyCadTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (isCadPartTool(name)) return callCadPartTool(name, args);
  return callClaudeCadTool(name, args);
}

export async function dispatchCadMcp(message: JsonRpc, hooks: CadMcpHooks = {}): Promise<void> {
  const method = String(message.method ?? "");
  const id = message.id;
  if (method === "initialize") {
    writeFrame({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "vantage-cad", version: "0.1.1" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") {
    if (id !== undefined && id !== null) writeFrame({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    writeFrame({ jsonrpc: "2.0", id, result: { tools: cadMcpToolList() } });
    return;
  }
  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await callAnyCadTool(name, args);
      writeFrame({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
      if (hooks.onToolCall) await Promise.resolve(hooks.onToolCall(name, args, true)).catch(() => undefined);
    } catch (error) {
      const text = error instanceof Error ? error.message : "CAD tool failed";
      writeFrame({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text }], isError: true },
      });
      if (hooks.onToolCall) await Promise.resolve(hooks.onToolCall(name, args, false, text)).catch(() => undefined);
    }
    return;
  }
  if (id !== undefined && id !== null) {
    writeFrame({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported method ${method || "(none)"}` } });
  }
}

export async function runCadMcpStdio(hooks: CadMcpHooks = {}) {
  let buffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        const asText = buffer.toString("utf8");
        const nl = asText.indexOf("\n");
        if (nl !== -1 && asText.trimStart().startsWith("{")) {
          const line = asText.slice(0, nl).trim();
          buffer = Buffer.from(asText.slice(nl + 1), "utf8");
          try {
            void dispatchCadMcp(JSON.parse(line) as JsonRpc, hooks);
          } catch {
            /* ignore incomplete */
          }
          continue;
        }
        return;
      }
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      try {
        void dispatchCadMcp(JSON.parse(body) as JsonRpc, hooks);
      } catch {
        /* ignore */
      }
    }
  });
}
