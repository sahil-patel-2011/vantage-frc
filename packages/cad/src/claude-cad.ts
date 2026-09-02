import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CadOperation } from "./agent-policy";
import { exportOnshapeElementFile, type OnshapeExportedFile } from "./onshape-export";
import { vantageCadHome } from "./onshape-session-store";
import { CAD_TOOL_CATALOG, cadToolInputSchema, cadToolSpec, cadToolSupportMatrix } from "./cad-tool-catalog";
import { assertFusionRelayParity, FUSION_RELAY_PROTOCOL_VERSION, signFusionRelayJob } from "./fusion-relay";
import {
  forgetSessionFeature,
  lastSessionFeature,
  loadClaudeCadSession,
  recordSessionFeature,
  requireBoundDocument,
  saveClaudeCadSession,
  sessionOwnsFeature,
  type CadSessionFeature,
  type CadSessionFeatureKind,
  type ClaudeCadSession,
} from "./claude-session";
import {
  createOnshapeApiKeyHttp,
  onshapeApiKeysStatus,
  onshapeHttpError,
  readOnshapeApiKeys,
  readOnshapeJson,
  type OnshapeKeyHttp,
} from "./onshape-api-keys";
import {
  chamferFeature,
  circleSketchFeature,
  circularPatternFeature,
  extrudeFeature,
  filletFeature,
  holeFeature,
  linearPatternFeature,
  mirrorFeature,
  onshapeFeaturePath,
  parseAddedFeatureId,
  patternAxisPlaneId,
  pointsSketchFeature,
  polygonSketchFeature,
  polylineSketchFeature,
  rectangleSketchFeature,
  shellFeature,
  slotSketchFeature,
  variableFeature,
  type CircleSpec,
  type OnshapeExportFileFormat,
  type OnshapeVariableType,
  type SketchPointMm,
} from "./onshape-features";
import {
  resolveOnshapeAxisIds,
  resolveOnshapeEdgeIds,
  resolveOnshapeFaceIds,
  resolveOnshapeSolidBodyIds,
  resolveOnshapeVertexIds,
  type EdgeSelection,
  type FaceSelection,
} from "./onshape-resolve";
import { explainFeatureTreeForStudents, type OnshapeFeatureSummary } from "./onshape";

/** Where an exported file went: the team vault (hosted) or a path on disk (terminal). */
export type CadExportDestination =
  | { kind: "vault"; documentId: string; version: number; href: string; duplicate: boolean; title: string }
  | { kind: "file"; path: string };

export type CadExportSink = (input: {
  file: OnshapeExportedFile;
  /** Vault document title, from the tool args or the bound element name. */
  title: string;
  changeNote: string | null;
  document: { documentId: string; workspaceId: string; elementId: string };
}) => Promise<CadExportDestination>;

/** Optional hosted runtime so the web CAD agent can use org OAuth + DB session instead of env keys. */
export type ClaudeCadRuntime = {
  http?: OnshapeKeyHttp;
  loadSession?: () => Promise<ClaudeCadSession>;
  saveSession?: (session: ClaudeCadSession) => Promise<void>;
  /** Skip loopback Fusion probes (Vercel / hosted). */
  hosted?: boolean;
  /**
   * Receives the real bytes of an export. The hosted agent stores them as a CAD
   * vault version; when absent the terminal writes the file under the vantage-cad
   * home directory. Either way the tool result names where the file went.
   */
  saveExport?: CadExportSink;
};

export const CLAUDE_CAD_INSTRUCTIONS = `Vantage CAD from Claude Code (terminal)

Onshape (cloud, any OS)
1. Create an API key pair: https://dev-portal.onshape.com/keys
2. In this terminal:
   PowerShell:  $env:ONSHAPE_ACCESS_KEY="..."; $env:ONSHAPE_SECRET_KEY="..."
   bash:        export ONSHAPE_ACCESS_KEY=... ONSHAPE_SECRET_KEY=...
3. Open a disposable Onshape document + Part Studio (do not test in a competition robot doc).
4. Ask Claude: "list my Onshape documents" then "bind that Part Studio, then make a 80x50x6 mm plate
   with 5 mm corner fillets and a 4x row of 5 mm holes on 20 mm pitch".

Onshape tools: list/bind/describe · sketch rectangle, circle, polyline, slot, polygon, hole points ·
extrude (NEW/ADD/REMOVE/INTERSECT) · fillet · chamfer · hole · shell · set variable ·
linear + circular pattern · mirror · export STL/STEP · delete-feature (undo the agent's own features).
Run cad_tools for the full list with Fusion support.

Fusion 360 (Windows/macOS only — never hosted)
1. Install Autodesk Fusion and the Vantage add-in:
   powershell -ExecutionPolicy Bypass -File .\\scripts\\cad\\install-windows.ps1
2. In Fusion: Utilities → Add-Ins → run VantageCadRelay (listens on 127.0.0.1:32145).
3. Open a disposable design. Ask Claude: "sketch a 40x20 mm rectangle in Fusion and extrude 10 mm".
Fusion supports sketch rectangle/circle, extrude, fillet, chamfer, and undo. Holes, patterns, mirror,
and polylines are Onshape only.

Claude Code MCP (from the repo root)
  claude mcp add vantage-cad -- node packages/vantage-cad-cli/bin/vantage-cad.mjs mcp
or keep the checked-in .mcp.json and restart Claude Code.

CLI without MCP
  vantage-cad claude
  vantage-cad doctor
  vantage-cad onshape docs

Team sync (optional)
  vantage-cad setup   pair this machine — CAD work then appears on your team's /cad page
  vantage-cad status  platform, binding, login state, sync state
  Unpaired or offline? Everything still works locally; sync resumes on its own.

Never paste API secrets into chat. Not certified engineering software.`;

export const CLAUDE_CAD_TOOLS = CAD_TOOL_CATALOG.map((tool) => ({
  name: tool.name,
  description:
    tool.fusion === "unsupported" && tool.onshape === "supported"
      ? `${tool.description} (Onshape only.)`
      : tool.description,
  inputSchema: cadToolInputSchema(tool),
}));

export type ClaudeCadToolName = (typeof CAD_TOOL_CATALOG)[number]["name"];

export type CadToolNarration = {
  /** One-line "what just happened", suitable for a session step log. */
  title: string;
  detail?: string;
};

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
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

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  const single = str(value);
  return single ? [single] : [];
}

function pointList(value: unknown, label: string): SketchPointMm[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of { xMm, yMm } points.`);
  return value.map((raw, index) => {
    const point = (raw ?? {}) as Record<string, unknown>;
    const xMm = optionalNum(point.xMm ?? point.x);
    const yMm = optionalNum(point.yMm ?? point.y);
    if (xMm === undefined || yMm === undefined) {
      throw new Error(`${label}[${index}] needs numeric xMm and yMm.`);
    }
    return { xMm, yMm };
  });
}

function fusionEndpoint() {
  const raw = (process.env.FUSION_PLUGIN_URL ?? "http://127.0.0.1:32145").trim();
  const url = new URL(raw);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Fusion plugin URL must be loopback (127.0.0.1).");
  }
  return url.toString().replace(/\/$/, "");
}

async function requireOnshapeHttp() {
  const creds = readOnshapeApiKeys();
  if (!creds) throw new Error(onshapeApiKeysStatus().message);
  return createOnshapeApiKeyHttp(creds);
}

async function getHttp(runtime: ClaudeCadRuntime): Promise<OnshapeKeyHttp> {
  if (runtime.http) return runtime.http;
  return requireOnshapeHttp();
}

async function getSession(runtime: ClaudeCadRuntime): Promise<ClaudeCadSession> {
  if (runtime.loadSession) return runtime.loadSession();
  return loadClaudeCadSession();
}

async function putSession(runtime: ClaudeCadRuntime, session: ClaudeCadSession): Promise<void> {
  if (runtime.saveSession) {
    await runtime.saveSession(session);
    return;
  }
  await saveClaudeCadSession(session);
}

/**
 * Probe the local relay and report what it can actually run. `parity` compares the
 * add-in's own operation list with this build's expectation, so a stale add-in is
 * named up front instead of failing halfway through a build.
 */
async function probeFusionHealth(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${fusionEndpoint()}/health`, { signal: AbortSignal.timeout(3_000) });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const parity = assertFusionRelayParity(body.operations);
    return {
      reachable: response.ok,
      ...body,
      parity,
      ...(parity.inSync ? {} : { message: parity.note }),
    };
  } catch {
    return {
      reachable: false,
      setupRequired: true,
      message:
        "Fusion add-in is not listening on 127.0.0.1:32145. Open Fusion → Utilities → Add-Ins → run VantageCadRelay. Linux has no Fusion — use Onshape.",
    };
  }
}

function hostedFusionUnavailable() {
  return {
    reachable: false,
    setupRequired: true,
    message:
      "Fusion 360 is not available in the hosted CAD agent. Use Onshape here, or run vantage-cad on your PC for Fusion.",
  };
}

function unsupportedOnFusion(tool: string) {
  const spec = cadToolSpec(tool);
  return {
    ok: false,
    unsupported: true,
    platform: "fusion360",
    error: `${spec?.label ?? tool} is Onshape only. ${spec?.fusionNote ?? "The Fusion add-in does not implement this operation."}`,
  };
}

async function fusionExecute(operation: string, parameters: Record<string, unknown>) {
  const envelope = signFusionRelayJob({
    version: FUSION_RELAY_PROTOCOL_VERSION,
    jobId: `claude-${randomUUID()}`,
    stepId: `step-${randomUUID().slice(0, 8)}`,
    orgId: "local-claude",
    userId: "local-claude",
    deviceId: "claude-code",
    machineName: "claude-code",
    nonce: randomUUID(),
    leaseToken: "claude-local",
    operation: {
      operation: operation as CadOperation,
      parameters,
      requiresApproval: true,
      reason: "Claude Code local Fusion tool",
    },
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const response = await fetch(`${fusionEndpoint()}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((body as { error?: string }).error ?? `Fusion execute HTTP ${response.status}`));
  }
  return body;
}

// ---------------------------------------------------------------------------
// Onshape helpers shared by the geometry tools
// ---------------------------------------------------------------------------

type BoundDoc = { documentId: string; workspaceId: string; elementId: string };

async function addOnshapeFeature(
  http: OnshapeKeyHttp,
  doc: BoundDoc,
  payload: unknown,
): Promise<string> {
  const response = await http(onshapeFeaturePath(doc), { method: "POST", body: JSON.stringify(payload) });
  const body = await readOnshapeJson(response);
  if (!response.ok) throw onshapeHttpError(response.status, body);
  return parseAddedFeatureId(body);
}

/** Record the new feature on the session so later tools can chain off it. */
async function trackFeature(
  runtime: ClaudeCadRuntime,
  session: ClaudeCadSession,
  feature: Omit<CadSessionFeature, "at">,
): Promise<ClaudeCadSession> {
  const next = recordSessionFeature(session, { ...feature, at: new Date().toISOString() });
  await putSession(runtime, next);
  return next;
}

function requireSessionFeature(
  session: ClaudeCadSession,
  explicitId: string,
  kinds: readonly CadSessionFeatureKind[],
  hint: string,
): { featureId: string; plane?: string } {
  if (explicitId) {
    const known = (session.features ?? []).find((feature) => feature.featureId === explicitId);
    return { featureId: explicitId, plane: known?.plane };
  }
  const last = lastSessionFeature(session, kinds);
  if (!last) throw new Error(hint);
  return { featureId: last.featureId, plane: last.plane };
}

function noGeometryMatched(what: string, featureId: string): Error {
  return new Error(
    `Onshape returned no ${what} for feature ${featureId}. Nothing was changed. Run onshape_describe to see the real feature tree, then pass an explicit featureId.`,
  );
}

/** Terminal fallback for exports: a file under the vantage-cad home, never the transcript. */
async function writeExportToDisk(file: OnshapeExportedFile): Promise<CadExportDestination> {
  const dir = join(vantageCadHome(), "exports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}-${file.filename}`);
  await writeFile(path, file.bytes, { mode: 0o600 });
  return { kind: "file", path };
}

async function runExport(
  name: string,
  format: OnshapeExportFileFormat,
  args: Record<string, unknown>,
  runtime: ClaudeCadRuntime,
) {
  const http = await getHttp(runtime);
  const session = await getSession(runtime);
  const doc = requireBoundDocument(session);
  const elementName = session.elementName || session.documentName || undefined;
  const file = await exportOnshapeElementFile(http, doc, format, { elementName });
  const title = str(args.title) || elementName || "Part Studio export";
  const changeNote = str(args.changeNote) || null;
  const destination: CadExportDestination = runtime.saveExport
    ? await runtime.saveExport({ file, title, changeNote, document: doc })
    : await writeExportToDisk(file);
  const upper = format.toUpperCase();
  const size = `${(file.byteLength / 1024).toFixed(file.byteLength < 10_240 ? 1 : 0)} KB`;
  return {
    ok: true,
    format,
    filename: file.filename,
    byteLength: file.byteLength,
    sha256: file.sha256,
    ...(file.translationId ? { translationId: file.translationId } : {}),
    destination,
    operation: name,
    narration: {
      title:
        destination.kind === "vault"
          ? `${destination.duplicate ? "Matched" : "Saved"} ${upper} (${size}) to the vault as "${destination.title}" v${destination.version}`
          : `Exported ${upper} (${size}) to ${destination.path}`,
      detail: destination.kind === "vault" ? destination.href : `sha256 ${file.sha256.slice(0, 12)}…`,
    } satisfies CadToolNarration,
  };
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

export async function callClaudeCadTool(
  name: string,
  args: Record<string, unknown> = {},
  runtime: ClaudeCadRuntime = {},
): Promise<unknown> {
  switch (name) {
    case "cad_setup":
      return { instructions: CLAUDE_CAD_INSTRUCTIONS };
    case "cad_tools":
      return {
        tools: cadToolSupportMatrix(),
        note: "Onshape runs in the cloud for every OS. Fusion runs only through the local VantageCadRelay add-in on Windows/macOS.",
      };
    case "cad_status": {
      const keys = runtime.http
        ? { configured: true, setupRequired: false, message: "Onshape is connected for this team member." }
        : onshapeApiKeysStatus();
      const session = await getSession(runtime);
      const fusion: unknown = runtime.hosted ? hostedFusionUnavailable() : await probeFusionHealth();
      return {
        onshape: keys,
        boundPartStudio: session.documentId
          ? {
              documentId: session.documentId,
              workspaceId: session.workspaceId,
              elementId: session.elementId,
              documentName: session.documentName ?? null,
            }
          : null,
        featuresThisSession: (session.features ?? []).length,
        lastFeature: lastSessionFeature(session) ?? null,
        fusion,
        disclaimer: "Not certified engineering software. Use a disposable document.",
      };
    }
    case "onshape_list_documents": {
      const http = await getHttp(runtime);
      const limit = Math.min(40, Math.max(1, Math.floor(num(args.limit, 12))));
      const response = await http(`/documents?filter=0&offset=0&limit=${limit}`);
      const body = (await readOnshapeJson(response)) as { items?: Array<Record<string, unknown>> };
      if (!response.ok) throw onshapeHttpError(response.status, body);
      return {
        documents: (body.items ?? []).map((item) => ({
          id: String(item.id),
          name: String(item.name ?? "Untitled"),
          defaultWorkspaceId: item.defaultWorkspace
            ? String((item.defaultWorkspace as { id?: string }).id ?? "")
            : "",
        })),
      };
    }
    case "onshape_list_elements": {
      const http = await getHttp(runtime);
      const documentId = str(args.documentId);
      const workspaceId = str(args.workspaceId);
      const response = await http(`/documents/d/${documentId}/w/${workspaceId}/elements`);
      const body = await readOnshapeJson(response);
      if (!response.ok) throw onshapeHttpError(response.status, body);
      const items = Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? []);
      return {
        elements: (items as Array<Record<string, unknown>>).map((item) => ({
          id: String(item.id),
          name: String(item.name ?? "Element"),
          elementType: String(item.elementType ?? item.type ?? ""),
        })),
      };
    }
    case "onshape_bind": {
      const previous = await getSession(runtime);
      const next: ClaudeCadSession = {
        documentId: str(args.documentId),
        workspaceId: str(args.workspaceId),
        elementId: str(args.elementId),
        documentName: str(args.documentName) || undefined,
      };
      if (!next.documentId || !next.workspaceId || !next.elementId) {
        throw new Error("documentId, workspaceId, and elementId are required.");
      }
      // Feature history is per-binding: undo must never point at another document.
      const sameDocument =
        previous.documentId === next.documentId &&
        previous.workspaceId === next.workspaceId &&
        previous.elementId === next.elementId;
      if (sameDocument) {
        next.features = previous.features;
        next.lastSketchFeatureId = previous.lastSketchFeatureId;
        next.documentName = next.documentName ?? previous.documentName;
      }
      await putSession(runtime, next);
      return {
        bound: next,
        note: "Edits go to this Part Studio until you bind another.",
        narration: {
          title: `Bound ${next.documentName || "Part Studio"}`,
          detail: `document ${next.documentId.slice(0, 10)}… · element ${next.elementId.slice(0, 10)}…`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_describe": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const response = await http(onshapeFeaturePath(doc));
      const body = (await readOnshapeJson(response)) as { features?: Array<Record<string, unknown>> };
      if (!response.ok) throw onshapeHttpError(response.status, body);
      const features: OnshapeFeatureSummary[] = (body.features ?? []).map((feature) => {
        const message = feature.message as Record<string, unknown> | undefined;
        return {
          id: String(feature.featureId ?? feature.nodeId ?? ""),
          name: String(message?.name ?? feature.name ?? "Feature"),
          featureType: String(message?.featureType ?? feature.featureType ?? "unknown"),
          suppressed: Boolean(message?.suppressed ?? feature.suppressed ?? false),
        };
      });
      const owned = new Set((session.features ?? []).map((feature) => feature.featureId));
      return {
        features: features.map((feature) => ({
          id: feature.id,
          name: feature.name,
          featureType: feature.featureType,
          suppressed: feature.suppressed,
          addedByVantage: owned.has(feature.id),
        })),
        explain: explainFeatureTreeForStudents(features),
        narration: {
          title: `Read the feature tree — ${features.length} feature${features.length === 1 ? "" : "s"}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_sketch_rectangle": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const widthMm = num(args.widthMm, 40);
      const heightMm = num(args.heightMm, 40);
      const plane = str(args.plane) || "Top";
      const featureId = await addOnshapeFeature(
        http,
        doc,
        rectangleSketchFeature({
          widthMm,
          heightMm,
          plane,
          originXMm: optionalNum(args.originXMm),
          originYMm: optionalNum(args.originYMm),
          name: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "sketch",
        tool: name,
        name: str(args.name) || "VantageSketch",
        plane,
      });
      return {
        ok: true,
        featureId,
        operation: "create_sketch",
        narration: {
          title: `Sketched a ${widthMm}×${heightMm} mm rectangle on ${plane}`,
          detail: `feature ${featureId}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_sketch_circle": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const plane = str(args.plane) || "Top";
      const circles: CircleSpec[] = Array.isArray(args.circles)
        ? (args.circles as Array<Record<string, unknown>>).map((raw, index) => {
            const diameterMm = optionalNum(raw?.diameterMm ?? raw?.diameter);
            if (diameterMm === undefined) throw new Error(`circles[${index}] needs a numeric diameterMm.`);
            return {
              diameterMm,
              centerXMm: optionalNum(raw?.centerXMm ?? raw?.x),
              centerYMm: optionalNum(raw?.centerYMm ?? raw?.y),
            };
          })
        : [
            {
              diameterMm: num(args.diameterMm, 0),
              centerXMm: optionalNum(args.centerXMm),
              centerYMm: optionalNum(args.centerYMm),
            },
          ];
      const featureId = await addOnshapeFeature(
        http,
        doc,
        circleSketchFeature({ circles, plane, name: str(args.name) || undefined }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "sketch",
        tool: name,
        name: str(args.name) || "VantageCircles",
        plane,
      });
      return {
        ok: true,
        featureId,
        operation: "create_sketch",
        circles: circles.length,
        narration: {
          title: `Sketched ${circles.length} circle${circles.length === 1 ? "" : "s"} on ${plane}`,
          detail: circles.map((circle) => `⌀${circle.diameterMm} mm`).join(", "),
        } satisfies CadToolNarration,
      };
    }
    case "onshape_sketch_polyline": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const plane = str(args.plane) || "Top";
      const points = pointList(args.points, "points");
      const closed = bool(args.closed, true);
      const featureId = await addOnshapeFeature(
        http,
        doc,
        polylineSketchFeature({ points, closed, plane, name: str(args.name) || undefined }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "sketch",
        tool: name,
        name: str(args.name) || "VantagePolyline",
        plane,
      });
      return {
        ok: true,
        featureId,
        operation: "create_sketch",
        narration: {
          title: `Sketched a ${closed ? "closed" : "open"} polyline of ${points.length} points on ${plane}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_sketch_points": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const plane = str(args.plane) || "Top";
      let points: SketchPointMm[];
      if (Array.isArray(args.points)) {
        points = pointList(args.points, "points");
      } else {
        const countX = Math.round(num(args.gridCountX, 0));
        const countY = Math.round(num(args.gridCountY, 1));
        const pitchX = num(args.gridPitchXMm, 0);
        const pitchY = num(args.gridPitchYMm, pitchX);
        if (countX < 1 || countY < 1) {
          throw new Error("Give explicit points [{xMm,yMm}], or gridCountX (and gridPitchXMm) for a row of holes.");
        }
        if (countX > 1 && pitchX <= 0) throw new Error("gridPitchXMm must be a positive millimetre spacing.");
        if (countY > 1 && pitchY <= 0) throw new Error("gridPitchYMm must be a positive millimetre spacing.");
        const originX = num(args.originXMm, 0);
        const originY = num(args.originYMm, 0);
        points = [];
        for (let row = 0; row < countY; row++) {
          for (let col = 0; col < countX; col++) {
            points.push({ xMm: originX + col * pitchX, yMm: originY + row * pitchY });
          }
        }
      }
      const featureId = await addOnshapeFeature(
        http,
        doc,
        pointsSketchFeature({ points, plane, name: str(args.name) || undefined }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "points",
        tool: name,
        name: str(args.name) || "VantageHolePoints",
        plane,
      });
      return {
        ok: true,
        featureId,
        operation: "create_sketch",
        points: points.length,
        narration: {
          title: `Placed ${points.length} hole point${points.length === 1 ? "" : "s"} on ${plane}`,
          detail: "Feed this featureId to onshape_hole.",
        } satisfies CadToolNarration,
      };
    }
    case "onshape_sketch_slot": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const plane = str(args.plane) || "Top";
      const lengthMm = num(args.lengthMm, 0);
      const widthMm = num(args.widthMm, 0);
      const featureId = await addOnshapeFeature(
        http,
        doc,
        slotSketchFeature({
          lengthMm,
          widthMm,
          centerXMm: optionalNum(args.centerXMm),
          centerYMm: optionalNum(args.centerYMm),
          angleDeg: optionalNum(args.angleDeg),
          plane,
          name: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "sketch",
        tool: name,
        name: str(args.name) || "VantageSlot",
        plane,
      });
      return {
        ok: true,
        featureId,
        operation: "create_sketch",
        narration: {
          title: `Sketched a ${lengthMm}×${widthMm} mm slot on ${plane}`,
          detail: `feature ${featureId}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_sketch_polygon": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const plane = str(args.plane) || "Top";
      const sides = Math.round(num(args.sides, 0));
      const acrossFlatsMm = optionalNum(args.acrossFlatsMm);
      const circumscribedDiameterMm = optionalNum(args.circumscribedDiameterMm);
      const featureId = await addOnshapeFeature(
        http,
        doc,
        polygonSketchFeature({
          sides,
          acrossFlatsMm,
          circumscribedDiameterMm,
          centerXMm: optionalNum(args.centerXMm),
          centerYMm: optionalNum(args.centerYMm),
          rotationDeg: optionalNum(args.rotationDeg),
          plane,
          name: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "sketch",
        tool: name,
        name: str(args.name) || "VantagePolygon",
        plane,
      });
      return {
        ok: true,
        featureId,
        operation: "create_sketch",
        narration: {
          title: `Sketched a ${sides}-sided polygon (${acrossFlatsMm !== undefined ? `${acrossFlatsMm} mm across flats` : `⌀${circumscribedDiameterMm} mm`}) on ${plane}`,
          detail: `feature ${featureId}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_extrude": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const sketchFeatureId = str(args.sketchFeatureId) || session.lastSketchFeatureId || "";
      const depthMm = num(args.depthMm, 10);
      const operationType = (str(args.operationType).toUpperCase() || "NEW") as "NEW" | "ADD" | "REMOVE" | "INTERSECT";
      const sketchPlane = (session.features ?? []).find((feature) => feature.featureId === sketchFeatureId)?.plane;
      const featureId = await addOnshapeFeature(
        http,
        doc,
        extrudeFeature({
          depthMm,
          sketchFeatureId,
          operationType,
          oppositeDirection: bool(args.oppositeDirection),
          name: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "solid",
        tool: name,
        name: str(args.name) || "VantageExtrude",
        plane: sketchPlane,
      });
      return {
        ok: true,
        featureId,
        operation: "create_extrude",
        narration: {
          title: `Extruded ${depthMm} mm (${operationType})`,
          detail: `from sketch ${sketchFeatureId}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_fillet":
    case "onshape_chamfer": {
      const isFillet = name === "onshape_fillet";
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const target = requireSessionFeature(
        session,
        str(args.featureId),
        ["solid"],
        `No solid to ${isFillet ? "fillet" : "chamfer"} yet. Extrude something first, or pass an explicit featureId from onshape_describe.`,
      );
      const selection = (str(args.selection).toLowerCase() || "corners") as EdgeSelection;
      if (selection !== "corners" && selection !== "all") {
        throw new Error("selection must be 'corners' or 'all'.");
      }
      const plane = str(args.plane) || target.plane || "Top";
      const edgeIds = await resolveOnshapeEdgeIds(http, doc, { featureId: target.featureId, selection, plane });
      if (!edgeIds.length) throw noGeometryMatched(selection === "corners" ? "corner edges" : "edges", target.featureId);
      const sizeMm = isFillet ? num(args.radiusMm, 0) : num(args.widthMm, 0);
      const payload = isFillet
        ? filletFeature({ edgeIds, radiusMm: sizeMm, name: str(args.name) || undefined })
        : chamferFeature({ edgeIds, widthMm: sizeMm, name: str(args.name) || undefined });
      const featureId = await addOnshapeFeature(http, doc, payload);
      await trackFeature(runtime, session, {
        featureId,
        kind: "modify",
        tool: name,
        name: str(args.name) || (isFillet ? "VantageFillet" : "VantageChamfer"),
        plane,
      });
      return {
        ok: true,
        featureId,
        edgeCount: edgeIds.length,
        operation: isFillet ? "create_fillet" : "create_chamfer",
        narration: {
          title: `${isFillet ? "Filleted" : "Chamfered"} ${edgeIds.length} ${selection === "corners" ? "corner " : ""}edge${edgeIds.length === 1 ? "" : "s"} at ${sizeMm} mm`,
          detail: `on feature ${target.featureId}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_hole": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const pointSketch = requireSessionFeature(
        session,
        str(args.pointSketchFeatureId),
        ["points"],
        "No hole points yet. Call onshape_sketch_points first (it accepts explicit points or a grid), then onshape_hole.",
      );
      const locationIds = await resolveOnshapeVertexIds(http, doc, pointSketch.featureId);
      if (!locationIds.length) throw noGeometryMatched("sketch points", pointSketch.featureId);
      const targetFeatureId = str(args.targetFeatureId) || undefined;
      const scopeIds = await resolveOnshapeSolidBodyIds(http, doc, targetFeatureId);
      if (!scopeIds.length) {
        throw new Error(
          "There is no solid body to drill. Extrude the stock first — a hole cannot be cut into empty space.",
        );
      }
      const diameterMm = num(args.diameterMm, 0);
      const endStyle = (str(args.endStyle).toUpperCase() || "THROUGH") as "THROUGH" | "BLIND";
      const depthMm = optionalNum(args.depthMm);
      const featureId = await addOnshapeFeature(
        http,
        doc,
        holeFeature({
          locationIds,
          scopeIds,
          diameterMm,
          endStyle,
          depthMm,
          name: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "modify",
        tool: name,
        name: str(args.name) || "VantageHole",
        plane: pointSketch.plane,
      });
      return {
        ok: true,
        featureId,
        holeCount: locationIds.length,
        operation: "create_hole",
        narration: {
          title: `Drilled ${locationIds.length}× ⌀${diameterMm} mm ${endStyle === "BLIND" ? `${depthMm} mm deep` : "through"} hole${locationIds.length === 1 ? "" : "s"}`,
          detail: `at the points of ${pointSketch.featureId}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_linear_pattern": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const featureIds = stringList(args.featureIds);
      const targets = featureIds.length
        ? featureIds
        : [
            requireSessionFeature(session, "", ["modify", "solid", "pattern"], "Nothing to pattern yet — build a feature first.")
              .featureId,
          ];
      const direction = str(args.direction).toUpperCase() || "X";
      const spacingMm = num(args.spacingMm, 0);
      const instanceCount = num(args.instanceCount, 0);
      const featureId = await addOnshapeFeature(
        http,
        doc,
        linearPatternFeature({
          featureIds: targets,
          directionIds: [patternAxisPlaneId(direction)],
          spacingMm,
          instanceCount,
          oppositeDirection: bool(args.oppositeDirection),
          name: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "pattern",
        tool: name,
        name: str(args.name) || "VantageLinearPattern",
      });
      return {
        ok: true,
        featureId,
        operation: "create_pattern",
        narration: {
          title: `Patterned ${targets.length} feature${targets.length === 1 ? "" : "s"} ${instanceCount}× along ${direction} at ${spacingMm} mm pitch`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_circular_pattern": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const axisFeatureId = str(args.axisFeatureId);
      if (!axisFeatureId) {
        throw new Error(
          "axisFeatureId is required — pass the feature whose cylindrical face (a bore or drilled hole) the pattern rotates about.",
        );
      }
      const axisIds = await resolveOnshapeAxisIds(http, doc, axisFeatureId);
      if (!axisIds.length) throw noGeometryMatched("cylindrical faces", axisFeatureId);
      const featureIds = stringList(args.featureIds);
      const targets = featureIds.length
        ? featureIds
        : [
            requireSessionFeature(session, "", ["modify", "solid", "pattern"], "Nothing to pattern yet — build a feature first.")
              .featureId,
          ];
      const instanceCount = num(args.instanceCount, 0);
      const angleDeg = optionalNum(args.angleDeg) ?? 360;
      const featureId = await addOnshapeFeature(
        http,
        doc,
        circularPatternFeature({
          featureIds: targets,
          axisIds: [axisIds[0]!],
          instanceCount,
          angleDeg,
          equalSpacing: bool(args.equalSpacing, true),
          name: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "pattern",
        tool: name,
        name: str(args.name) || "VantageCircularPattern",
      });
      return {
        ok: true,
        featureId,
        operation: "create_pattern",
        narration: {
          title: `Patterned ${instanceCount}× around the axis of ${axisFeatureId} over ${angleDeg}°`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_mirror": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const featureIds = stringList(args.featureIds);
      const targets = featureIds.length
        ? featureIds
        : [
            requireSessionFeature(session, "", ["modify", "solid", "pattern"], "Nothing to mirror yet — build a feature first.")
              .featureId,
          ];
      const plane = str(args.plane) || "Right";
      const featureId = await addOnshapeFeature(
        http,
        doc,
        mirrorFeature({ featureIds: targets, plane, name: str(args.name) || undefined }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "pattern",
        tool: name,
        name: str(args.name) || "VantageMirror",
        plane,
      });
      return {
        ok: true,
        featureId,
        operation: "create_pattern",
        narration: {
          title: `Mirrored ${targets.length} feature${targets.length === 1 ? "" : "s"} across ${plane}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_shell": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const target = requireSessionFeature(
        session,
        str(args.featureId),
        ["solid"],
        "No solid to shell yet. Extrude something first, or pass an explicit featureId from onshape_describe.",
      );
      const plane = str(args.plane) || target.plane || "Top";
      const explicitFaces = stringList(args.faceIds);
      const faces = (str(args.faces).toLowerCase() || "top") as FaceSelection;
      const faceIds = explicitFaces.length
        ? explicitFaces
        : await resolveOnshapeFaceIds(http, doc, { featureId: target.featureId, selection: faces, plane });
      if (!faceIds.length) throw noGeometryMatched(`${faces} planar faces`, target.featureId);
      const thicknessMm = num(args.thicknessMm, 0);
      const featureId = await addOnshapeFeature(
        http,
        doc,
        shellFeature({
          faceIds,
          thicknessMm,
          oppositeDirection: bool(args.oppositeDirection),
          name: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "modify",
        tool: name,
        name: str(args.name) || "VantageShell",
        plane,
      });
      return {
        ok: true,
        featureId,
        faceCount: faceIds.length,
        operation: "create_shell",
        narration: {
          title: `Shelled to ${thicknessMm} mm walls, removing ${faceIds.length} ${explicitFaces.length ? "" : `${faces} `}face${faceIds.length === 1 ? "" : "s"}`,
          detail: `on feature ${target.featureId}`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_set_variable": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const variableName = str(args.variableName) || str(args.variable);
      const variableType = (str(args.variableType).toUpperCase() || "LENGTH") as OnshapeVariableType;
      const value = num(args.value, Number.NaN);
      const featureId = await addOnshapeFeature(
        http,
        doc,
        variableFeature({
          name: variableName,
          value,
          variableType,
          featureName: str(args.name) || undefined,
        }),
      );
      await trackFeature(runtime, session, {
        featureId,
        kind: "modify",
        tool: name,
        name: str(args.name) || `#${variableName}`,
      });
      const unit = variableType === "LENGTH" ? " mm" : variableType === "ANGLE" ? "°" : "";
      return {
        ok: true,
        featureId,
        operation: "set_variable",
        variable: { name: variableName, value, variableType },
        narration: {
          title: `Set #${variableName} = ${value}${unit}`,
          detail: `Variable feature ${featureId} — reference it as #${variableName} in Onshape dimensions.`,
        } satisfies CadToolNarration,
      };
    }
    case "onshape_export_stl":
      return runExport(name, "stl", args, runtime);
    case "onshape_export_step":
      return runExport(name, "step", args, runtime);
    case "onshape_delete_feature": {
      const http = await getHttp(runtime);
      const session = await getSession(runtime);
      const doc = requireBoundDocument(session);
      const explicit = str(args.featureId);
      const target = explicit || lastSessionFeature(session)?.featureId || "";
      if (!target) {
        throw new Error("This session has not added any features yet, so there is nothing to undo.");
      }
      if (!sessionOwnsFeature(session, target)) {
        throw new Error(
          `Feature ${target} was not created by Vantage in this binding. Delete it in Onshape yourself — the agent only undoes its own features.`,
        );
      }
      const response = await http(onshapeFeaturePath(doc, target), { method: "DELETE" });
      if (!response.ok) {
        const body = await readOnshapeJson(response).catch(() => null);
        throw onshapeHttpError(response.status, body);
      }
      const removed = (session.features ?? []).find((feature) => feature.featureId === target);
      await putSession(runtime, forgetSessionFeature(session, target));
      return {
        ok: true,
        deletedFeatureId: target,
        operation: "delete_feature",
        narration: {
          title: `Deleted ${removed?.name ?? "feature"} (${target})`,
          detail: "Undo applies only to features Vantage added in this binding.",
        } satisfies CadToolNarration,
      };
    }
    case "fusion_status": {
      if (runtime.hosted) return hostedFusionUnavailable();
      return probeFusionHealth();
    }
    case "fusion_describe":
      if (runtime.hosted) return hostedFusionUnavailable();
      return fusionExecute("verify_topology", {});
    case "fusion_sketch_rectangle":
      if (runtime.hosted) return hostedFusionUnavailable();
      return fusionExecute("create_sketch", {
        shape: "rectangle",
        widthMm: num(args.widthMm, 40),
        heightMm: num(args.heightMm, 40),
        name: str(args.name) || "VantageSketch",
      });
    case "fusion_sketch_circle":
      if (runtime.hosted) return hostedFusionUnavailable();
      return fusionExecute("create_sketch", {
        shape: "circle",
        diameterMm: num(args.diameterMm, 20),
        centerXMm: num(args.centerXMm, 0),
        centerYMm: num(args.centerYMm, 0),
        name: str(args.name) || "VantageSketch",
      });
    case "fusion_extrude":
      if (runtime.hosted) return hostedFusionUnavailable();
      return fusionExecute("create_extrude", { depthMm: num(args.depthMm, 10) });
    case "fusion_fillet":
      if (runtime.hosted) return hostedFusionUnavailable();
      return fusionExecute("create_fillet", { radiusMm: num(args.radiusMm, 2) });
    case "fusion_chamfer":
      if (runtime.hosted) return hostedFusionUnavailable();
      return fusionExecute("create_chamfer", { widthMm: num(args.widthMm, 2) });
    case "fusion_undo_last":
      if (runtime.hosted) return hostedFusionUnavailable();
      return fusionExecute("delete_feature", {});
    default: {
      if (name.startsWith("fusion_")) return unsupportedOnFusion(name);
      throw new Error(
        `Unknown CAD tool "${name}". Call cad_tools for the current list of Onshape and Fusion operations.`,
      );
    }
  }
}
