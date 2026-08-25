/**
 * The durable CAD edit session.
 *
 * The point of this file is that a user can say "make the plate 8 mm instead of 6"
 * an hour later, in a new process, and the agent edits the EXISTING feature by id
 * instead of rebuilding the part from scratch. That needs four things to survive a
 * restart: the bound document/workspace/element, the feature ids Vantage created,
 * the parameter values those features were last written with, and the resolved
 * geometry ids — plus a rule for when the geometry ids stop being true.
 *
 * The rule is the `rebuild` counter. Onshape re-evaluates the whole Part Studio
 * whenever the feature tree changes, and deterministic entity ids resolved before
 * that change may no longer address the same edge or face. So every mutation bumps
 * `rebuild`, and a cached geometry entry is only honoured when its `rebuild` still
 * matches. Stale ids are never handed back — the caller re-resolves through
 * onshape-resolve.ts, which is one FeatureScript call, rather than filleting the
 * wrong edge.
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mergeCallTally, type CallBudgetSummary, type PersistedCallTally } from "./call-budget";
import { vantageCadHome } from "./onshape-session-store";

export type CadSessionFeatureKind = "sketch" | "points" | "solid" | "modify" | "pattern";

/** Parameter values as last written to Onshape, so an edit can start from the real numbers. */
export type CadSessionParameters = Record<string, number | string | boolean>;

/** One feature this session added, so the agent can chain, edit, and undo without guessing ids. */
export type CadSessionFeature = {
  featureId: string;
  kind: CadSessionFeatureKind;
  tool: string;
  name: string;
  /** Sketch plane the feature was built on, when it has one. */
  plane?: string;
  at: string;
  /** Last-written parameter values — the starting point for "make it 8 mm instead". */
  parameters?: CadSessionParameters;
  /** Rebuild counter at the time this feature was created or last edited. */
  rebuild?: number;
  /** Set when the feature was edited in place rather than re-added. */
  updatedAt?: string;
};

/** A resolved geometry selection, valid only while `rebuild` still matches the session. */
export type CadGeometryCacheEntry = {
  featureId: string;
  /** Selection the ids were resolved for, e.g. "edges:corners" or "bodies". */
  selection: string;
  ids: string[];
  rebuild: number;
  at: string;
};

export type ClaudeCadSession = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
  lastSketchFeatureId?: string;
  documentName?: string;
  elementName?: string;
  /** Deep link back to the bound Part Studio. */
  url?: string;
  /** Features added by Vantage in this binding, oldest first. Bounded to 200. */
  features?: CadSessionFeature[];
  /** Bumped by every tree mutation; cached geometry ids from an older value are stale. */
  rebuild?: number;
  /** Onshape microversion observed at the last describe, when the caller recorded one. */
  microversionId?: string;
  geometry?: CadGeometryCacheEntry[];
  /** Lifetime Onshape call tally from this machine, split by auth path. */
  calls?: PersistedCallTally;
  boundAt?: string;
  updatedAt?: string;
};

export const CAD_SESSION_FEATURE_LIMIT = 200;
export const CAD_SESSION_GEOMETRY_LIMIT = 120;

const sessionPath = (env: NodeJS.ProcessEnv = process.env) => join(vantageCadHome(env), "claude-session.json");

export async function loadClaudeCadSession(env: NodeJS.ProcessEnv = process.env): Promise<ClaudeCadSession> {
  try {
    const raw = await readFile(sessionPath(env), "utf8");
    const parsed = JSON.parse(raw) as ClaudeCadSession;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveClaudeCadSession(
  next: ClaudeCadSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const dir = vantageCadHome(env);
  await mkdir(dir, { recursive: true });
  const path = sessionPath(env);
  const payload: ClaudeCadSession = { ...next, updatedAt: new Date().toISOString() };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  // writeFile's mode is ignored for an existing file; chmod is what actually holds 0600.
  await chmod(path, 0o600);
}

export function requireBoundDocument(session: ClaudeCadSession) {
  if (!session.documentId || !session.workspaceId || !session.elementId) {
    throw new Error(
      "No Part Studio bound. Call onshape_list_documents, then onshape_bind with documentId, workspaceId, and elementId from a disposable document.",
    );
  }
  return {
    documentId: session.documentId,
    workspaceId: session.workspaceId,
    elementId: session.elementId,
  };
}

export function isBoundToSameElement(
  session: ClaudeCadSession,
  document: { documentId: string; workspaceId: string; elementId: string },
): boolean {
  return (
    session.documentId === document.documentId &&
    session.workspaceId === document.workspaceId &&
    session.elementId === document.elementId
  );
}

/**
 * Bind (or re-bind) the session to a Part Studio.
 *
 * Re-binding the SAME element resumes: feature ids, parameters, and cached geometry
 * all still address real things. Binding a DIFFERENT element discards them, because
 * a feature id from another Part Studio would resolve to nothing — carrying it over
 * would be an invented reference.
 */
export function bindClaudeCadSession(
  session: ClaudeCadSession,
  document: {
    documentId: string;
    workspaceId: string;
    elementId: string;
    documentName?: string;
    elementName?: string;
    url?: string;
  },
  at = new Date().toISOString(),
): ClaudeCadSession {
  const resumed = isBoundToSameElement(session, document);
  const base: ClaudeCadSession = resumed
    ? session
    : { calls: session.calls, features: [], geometry: [], rebuild: 0, lastSketchFeatureId: undefined };
  return {
    ...base,
    documentId: document.documentId,
    workspaceId: document.workspaceId,
    elementId: document.elementId,
    ...(document.documentName ? { documentName: document.documentName } : {}),
    ...(document.elementName ? { elementName: document.elementName } : {}),
    ...(document.url ? { url: document.url } : {}),
    rebuild: base.rebuild ?? 0,
    boundAt: at,
  };
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function bumpRebuild(session: ClaudeCadSession): number {
  return (session.rebuild ?? 0) + 1;
}

/**
 * Append a created feature. Bumps the rebuild counter and drops every cached
 * geometry id, because the new feature just changed the regenerated context those
 * ids came from.
 */
export function recordSessionFeature(session: ClaudeCadSession, feature: CadSessionFeature): ClaudeCadSession {
  const rebuild = bumpRebuild(session);
  const features = [...(session.features ?? []), { ...feature, rebuild }].slice(-CAD_SESSION_FEATURE_LIMIT);
  return {
    ...session,
    features,
    rebuild,
    geometry: [],
    ...(feature.kind === "sketch" ? { lastSketchFeatureId: feature.featureId } : {}),
  };
}

export function forgetSessionFeature(session: ClaudeCadSession, featureId: string): ClaudeCadSession {
  const features = (session.features ?? []).filter((feature) => feature.featureId !== featureId);
  const lastSketch = [...features].reverse().find((feature) => feature.kind === "sketch");
  return {
    ...session,
    features,
    lastSketchFeatureId: lastSketch?.featureId,
    rebuild: bumpRebuild(session),
    geometry: [],
  };
}

export function lastSessionFeature(
  session: ClaudeCadSession,
  kinds?: readonly CadSessionFeatureKind[],
): CadSessionFeature | undefined {
  const features = session.features ?? [];
  for (let i = features.length - 1; i >= 0; i--) {
    const feature = features[i]!;
    if (!kinds || kinds.includes(feature.kind)) return feature;
  }
  return undefined;
}

export function findSessionFeature(session: ClaudeCadSession, featureId: string): CadSessionFeature | undefined {
  return (session.features ?? []).find((feature) => feature.featureId === featureId);
}

/** True when Vantage added this feature in this binding — the guard on delete. */
export function sessionOwnsFeature(session: ClaudeCadSession, featureId: string): boolean {
  return (session.features ?? []).some((feature) => feature.featureId === featureId);
}

/**
 * Record an in-place parameter edit. The feature id is unchanged (Onshape keeps it
 * across a feature update), but the tree regenerated, so this bumps rebuild and
 * invalidates cached geometry exactly like adding a feature does.
 */
export function updateSessionFeatureParameters(
  session: ClaudeCadSession,
  featureId: string,
  parameters: CadSessionParameters,
  at = new Date().toISOString(),
): ClaudeCadSession {
  const existing = findSessionFeature(session, featureId);
  if (!existing) {
    throw new Error(
      `Feature ${featureId} was not created in this session, so Vantage has no recorded parameters for it. Run onshape_describe and pass an explicit featureId.`,
    );
  }
  const rebuild = bumpRebuild(session);
  return {
    ...session,
    rebuild,
    geometry: [],
    features: (session.features ?? []).map((feature) =>
      feature.featureId === featureId
        ? {
            ...feature,
            parameters: { ...(feature.parameters ?? {}), ...parameters },
            rebuild,
            updatedAt: at,
          }
        : feature,
    ),
  };
}

/**
 * Resolve which feature an edit like "make the plate 8 mm" targets: an explicit id
 * when given, otherwise the most recent feature of a matching kind that actually
 * has the named parameter recorded. Returns undefined rather than guessing.
 */
export function findEditableFeature(
  session: ClaudeCadSession,
  input: { featureId?: string; parameter?: string; kinds?: readonly CadSessionFeatureKind[] },
): CadSessionFeature | undefined {
  if (input.featureId) return findSessionFeature(session, input.featureId);
  const features = session.features ?? [];
  for (let i = features.length - 1; i >= 0; i--) {
    const feature = features[i]!;
    if (input.kinds && !input.kinds.includes(feature.kind)) continue;
    if (input.parameter && !(input.parameter in (feature.parameters ?? {}))) continue;
    return feature;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Geometry id cache
// ---------------------------------------------------------------------------

export function cacheSessionGeometry(
  session: ClaudeCadSession,
  entry: { featureId: string; selection: string; ids: string[] },
  at = new Date().toISOString(),
): ClaudeCadSession {
  const rebuild = session.rebuild ?? 0;
  const kept = (session.geometry ?? []).filter(
    (item) => !(item.featureId === entry.featureId && item.selection === entry.selection),
  );
  return {
    ...session,
    geometry: [...kept, { ...entry, ids: [...entry.ids], rebuild, at }].slice(-CAD_SESSION_GEOMETRY_LIMIT),
  };
}

/**
 * Cached ids, but only while they are still true. A mismatched rebuild counter
 * returns undefined so the caller re-resolves against the live Part Studio.
 */
export function readSessionGeometry(
  session: ClaudeCadSession,
  featureId: string,
  selection: string,
): string[] | undefined {
  const rebuild = session.rebuild ?? 0;
  const hit = (session.geometry ?? []).find(
    (item) => item.featureId === featureId && item.selection === selection && item.rebuild === rebuild,
  );
  return hit ? [...hit.ids] : undefined;
}

/** Drop every cached id — used when an outside edit (Onshape UI, another agent) is suspected. */
export function invalidateSessionGeometry(session: ClaudeCadSession, microversionId?: string): ClaudeCadSession {
  return {
    ...session,
    geometry: [],
    rebuild: bumpRebuild(session),
    ...(microversionId ? { microversionId } : {}),
  };
}

/**
 * Reconcile against the microversion Onshape reports. A different microversion means
 * the document moved underneath us (someone edited it in the browser), so every
 * cached id is suspect and gets dropped.
 */
export function reconcileSessionMicroversion(
  session: ClaudeCadSession,
  microversionId: string,
): { session: ClaudeCadSession; changed: boolean } {
  if (!microversionId) return { session, changed: false };
  if (session.microversionId === microversionId) return { session, changed: false };
  const changed = Boolean(session.microversionId);
  return {
    session: changed ? invalidateSessionGeometry(session, microversionId) : { ...session, microversionId },
    changed,
  };
}

// ---------------------------------------------------------------------------
// Call accounting + human summary
// ---------------------------------------------------------------------------

export function noteSessionCalls(
  session: ClaudeCadSession,
  summary: CallBudgetSummary,
  at = new Date().toISOString(),
): ClaudeCadSession {
  return { ...session, calls: mergeCallTally(session.calls, summary, at) };
}

export type ClaudeCadSessionSummary = {
  bound: boolean;
  documentId: string | null;
  workspaceId: string | null;
  elementId: string | null;
  documentName: string | null;
  url: string | null;
  featureCount: number;
  lastFeature: CadSessionFeature | null;
  rebuild: number;
  cachedSelections: number;
  boundAt: string | null;
  updatedAt: string | null;
};

export function summarizeClaudeCadSession(session: ClaudeCadSession): ClaudeCadSessionSummary {
  return {
    bound: Boolean(session.documentId && session.workspaceId && session.elementId),
    documentId: session.documentId ?? null,
    workspaceId: session.workspaceId ?? null,
    elementId: session.elementId ?? null,
    documentName: session.documentName ?? null,
    url: session.url ?? null,
    featureCount: (session.features ?? []).length,
    lastFeature: lastSessionFeature(session) ?? null,
    rebuild: session.rebuild ?? 0,
    cachedSelections: (session.geometry ?? []).length,
    boundAt: session.boundAt ?? null,
    updatedAt: session.updatedAt ?? null,
  };
}

export function formatClaudeCadSession(session: ClaudeCadSession): string[] {
  const summary = summarizeClaudeCadSession(session);
  if (!summary.bound) {
    return ["CAD session: nothing bound yet — open a Part Studio URL with `vantage-cad onshape bind <url>`."];
  }
  const lines = [
    `CAD session: ${summary.documentName ?? summary.documentId} · element ${summary.elementId}`,
    `  ${summary.featureCount} feature${summary.featureCount === 1 ? "" : "s"} created here · rebuild ${summary.rebuild} · ${summary.cachedSelections} cached selection${summary.cachedSelections === 1 ? "" : "s"}`,
  ];
  if (summary.url) lines.push(`  ${summary.url}`);
  if (summary.lastFeature) {
    const parameters = summary.lastFeature.parameters;
    const shown = parameters
      ? Object.entries(parameters)
          .slice(0, 4)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" ")
      : "";
    lines.push(`  last: ${summary.lastFeature.tool} ${summary.lastFeature.featureId}${shown ? ` (${shown})` : ""}`);
  }
  return lines;
}
