import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CadOperation } from "./agent-policy";
import { callClaudeCadTool, type CadExportSink, type ClaudeCadRuntime } from "./claude-cad";
import type { ClaudeCadSession } from "./claude-session";
import { exportOnshapeElementFile, looksLikeAsciiStl, type OnshapeExportedFile } from "./onshape-export";
import { onshapeTranslationPayload } from "./onshape-features";

export const ONSHAPE_OAUTH_AUTHORIZE = "https://oauth.onshape.com/oauth/authorize";
export const ONSHAPE_OAUTH_TOKEN = "https://oauth.onshape.com/oauth/token";
export const ONSHAPE_API_BASE = "https://cad.onshape.com/api/v6";
export const ONSHAPE_DEFAULT_SCOPES = ["OAuth2Read", "OAuth2Write"] as const;

export type OnshapeOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
};

export type OnshapeTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
};

export type OnshapeDocumentRef = {
  documentId: string;
  workspaceId: string;
  elementId: string;
  elementType?: string;
  label?: string;
};

export function isOnshapeOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ONSHAPE_OAUTH_CLIENT_ID?.trim() && env.ONSHAPE_OAUTH_CLIENT_SECRET?.trim());
}

export function getOnshapeOAuthConfig(env: NodeJS.ProcessEnv = process.env): OnshapeOAuthConfig | null {
  if (!isOnshapeOAuthConfigured(env)) return null;
  const base = (env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return {
    clientId: env.ONSHAPE_OAUTH_CLIENT_ID!.trim(),
    clientSecret: env.ONSHAPE_OAUTH_CLIENT_SECRET!.trim(),
    redirectUri: (env.ONSHAPE_OAUTH_REDIRECT_URI?.trim() || `${base}/api/cad/onshape/oauth/callback`),
    scopes: (env.ONSHAPE_OAUTH_SCOPES?.trim() || ONSHAPE_DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
  };
}

export function onshapeSetupStatus(env: NodeJS.ProcessEnv = process.env) {
  const configured = isOnshapeOAuthConfigured(env);
  const config = configured ? getOnshapeOAuthConfig(env) : null;
  return {
    configured,
    setupRequired: !configured,
    redirectUri: config?.redirectUri ?? null,
    scopes: config?.scopes ?? [...ONSHAPE_DEFAULT_SCOPES],
    message: configured
      ? "Onshape OAuth client is configured. Users can connect in CAD Connections."
      : "Setup required — set ONSHAPE_OAUTH_CLIENT_ID and ONSHAPE_OAUTH_CLIENT_SECRET (and optional ONSHAPE_OAUTH_REDIRECT_URI).",
  };
}

function stateSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.BETTER_AUTH_SECRET ?? env.ONSHAPE_OAUTH_STATE_SECRET ?? "local-onshape-oauth-state";
}

export function createOnshapeOAuthState(input: { orgId: string; userId: string }, env: NodeJS.ProcessEnv = process.env) {
  const nonce = randomBytes(16).toString("base64url");
  const issuedAt = Date.now();
  const body = Buffer.from(JSON.stringify({ ...input, nonce, issuedAt }), "utf8").toString("base64url");
  const sig = createHmac("sha256", stateSecret(env)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOnshapeOAuthState(
  state: string,
  env: NodeJS.ProcessEnv = process.env,
  maxAgeMs = 15 * 60_000,
): { orgId: string; userId: string; nonce: string } {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Invalid OAuth state");
  const expected = createHmac("sha256", stateSecret(env)).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid OAuth state signature");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    orgId: string;
    userId: string;
    nonce: string;
    issuedAt: number;
  };
  if (!parsed.orgId || !parsed.userId || !parsed.nonce) throw new Error("OAuth state missing fields");
  if (Date.now() - parsed.issuedAt > maxAgeMs) throw new Error("OAuth state expired");
  return { orgId: parsed.orgId, userId: parsed.userId, nonce: parsed.nonce };
}

export function buildOnshapeAuthorizeUrl(config: OnshapeOAuthConfig, state: string) {
  const url = new URL(ONSHAPE_OAUTH_AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeOnshapeCode(
  config: OnshapeOAuthConfig,
  code: string,
): Promise<OnshapeTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const response = await fetch(ONSHAPE_OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error_description ?? data.error ?? "Onshape token exchange failed"));
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type ? String(data.token_type) : "Bearer",
    scope: data.scope ? String(data.scope) : undefined,
  };
}

export async function refreshOnshapeToken(
  config: OnshapeOAuthConfig,
  refreshToken: string,
): Promise<OnshapeTokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const response = await fetch(ONSHAPE_OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error_description ?? data.error ?? "Onshape token refresh failed"));
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token ?? refreshToken),
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type ? String(data.token_type) : "Bearer",
    scope: data.scope ? String(data.scope) : undefined,
  };
}

export type OnshapeHttp = (path: string, init?: RequestInit) => Promise<Response>;

export function createOnshapeHttp(accessToken: string, apiBase = ONSHAPE_API_BASE): OnshapeHttp {
  return (path, init = {}) =>
    fetch(`${apiBase}${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
}

export async function listOnshapeDocuments(http: OnshapeHttp, limit = 20) {
  const response = await http(`/documents?filter=0&offset=0&limit=${limit}`);
  const data = (await response.json()) as { items?: Array<Record<string, unknown>> };
  if (!response.ok) throw new Error("Failed to list Onshape documents");
  return (data.items ?? []).map((item) => ({
    id: String(item.id),
    name: String(item.name ?? "Untitled"),
    defaultWorkspaceId: item.defaultWorkspace
      ? String((item.defaultWorkspace as { id?: string }).id ?? "")
      : "",
  }));
}

export async function listOnshapeElements(http: OnshapeHttp, documentId: string, workspaceId: string) {
  const response = await http(`/documents/d/${documentId}/w/${workspaceId}/elements`);
  const data = (await response.json()) as Array<Record<string, unknown>> | { items?: Array<Record<string, unknown>> };
  if (!response.ok) throw new Error("Failed to list Onshape elements");
  const items = Array.isArray(data) ? data : (data.items ?? []);
  return items.map((item) => ({
    id: String(item.id),
    name: String(item.name ?? "Element"),
    elementType: String(item.elementType ?? item.type ?? ""),
  }));
}

export type OnshapeFeatureSummary = {
  id: string;
  name: string;
  featureType: string;
  suppressed: boolean;
  status?: string;
};

/** Fetch Part Studio feature tree (live OAuth). */
export async function listOnshapeFeatures(http: OnshapeHttp, document: OnshapeDocumentRef): Promise<OnshapeFeatureSummary[]> {
  const base = `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}`;
  const response = await http(`${base}/features`);
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to list Onshape features: ${err.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    features?: Array<Record<string, unknown>>;
  };
  return (data.features ?? []).map((feature) => {
    const message = feature.message as Record<string, unknown> | undefined;
    return {
      id: String(feature.featureId ?? feature.nodeId ?? feature.id ?? ""),
      name: String(message?.name ?? feature.name ?? "Feature"),
      featureType: String(message?.featureType ?? feature.featureType ?? feature.type ?? "unknown"),
      suppressed: Boolean(message?.suppressed ?? feature.suppressed ?? false),
      status: feature.status ? String(feature.status) : undefined,
    };
  });
}

const FEATURE_TYPE_PLAIN: Record<string, { plainEnglish: string; tip?: string }> = {
  newSketch: {
    plainEnglish: "A 2D drawing on a plane (Top/Front/Right or a face). Sketches define outlines before solids exist.",
    tip: "Change sketch dimensions before extruding when you can — it is easier than fixing a solid later.",
  },
  extrude: {
    plainEnglish: "Pushes a sketch into 3D: add material (NEW/ADD), cut (REMOVE), or intersect.",
    tip: "For holes, extrude REMOVE into the material. Cutting the wrong way often removes nothing.",
  },
  fillet: {
    plainEnglish: "Rounds sharp edges so parts are safer to handle and stress concentrates less.",
  },
  chamfer: {
    plainEnglish: "Bevels an edge at an angle — common on mating faces and bolt clearance.",
  },
  shell: {
    plainEnglish: "Hollows a solid to a wall thickness, optionally opening selected faces.",
  },
  revolve: {
    plainEnglish: "Spins a sketch around an axis to make round parts (hubs, rollers, pulleys).",
  },
  boolean: {
    plainEnglish: "Combines or subtracts existing solid bodies (union / subtract / intersect).",
  },
  transform: {
    plainEnglish: "Moves or copies geometry without redesigning the underlying sketch.",
  },
  patternLinear: {
    plainEnglish: "Repeats a feature or body along a line (bolt patterns, rib arrays).",
  },
  patternCircular: {
    plainEnglish: "Repeats a feature around an axis (spoke holes, gear-like cuts).",
  },
  mirror: {
    plainEnglish: "Reflects geometry across a plane — keep symmetric mechanisms maintainable.",
  },
  hole: {
    plainEnglish: "Standard hole with optional countersink/counterbore — prefer over hand-cut circles when sizing fasteners.",
  },
};

/**
 * Student-facing feature-tree walkthrough (not engineering certification).
 * Safe to call with live or stub feature lists.
 */
export function explainFeatureTreeForStudents(features: OnshapeFeatureSummary[]) {
  const active = features.filter((f) => !f.suppressed);
  const steps = active.map((feature, index) => {
    const key = Object.keys(FEATURE_TYPE_PLAIN).find((k) =>
      feature.featureType.toLowerCase().includes(k.toLowerCase().replace(/^new/, "")),
    );
    const matched =
      FEATURE_TYPE_PLAIN[feature.featureType] ??
      (key ? FEATURE_TYPE_PLAIN[key] : undefined) ?? {
        plainEnglish: `Onshape feature type “${feature.featureType}”. Open the feature params in Onshape to see exact dimensions.`,
        tip: "Ask a mentor what this step achieves in the mechanism before changing it.",
      };
    return {
      order: index + 1,
      name: feature.name,
      featureType: feature.featureType,
      status: feature.status,
      plainEnglish: matched.plainEnglish,
      tip: matched.tip,
    };
  });
  return {
    overview:
      active.length === 0
        ? "This Part Studio has no active features yet — start with a sketch on Top, then extrude."
        : `This Part Studio builds geometry in ${active.length} active step${active.length === 1 ? "" : "s"} (feature tree order). Read top → bottom: later features depend on earlier ones.`,
    steps,
    suppressedCount: features.length - active.length,
    disclaimer:
      "Educational explanation only — not stress analysis, manufacturing certification, or competition-legal advice.",
  };
}

export type OnshapeExportFormat = "STEP" | "STL" | "GLTF";

export type OnshapeExportProvenance = {
  format: OnshapeExportFormat;
  documentId: string;
  workspaceId: string;
  elementId: string;
  translationId?: string;
  requestState: string;
  contentSha256?: string;
  byteLength?: number;
  resultExternalDataIds?: string[];
  exportedAt: string;
  source: "onshape-api";
  /**
   * Where the real bytes went. "vault" / "file" mean the whole file was kept;
   * "metadata_only" is now only true for glTF, which the vault does not accept.
   * "inline_preview" is retained for old artifact rows and is never written anew.
   */
  storage: "metadata_only" | "inline_preview" | "vault" | "file";
  vault?: { documentId: string; version: number; href: string; title: string; duplicate: boolean };
  filePath?: string;
  note: string;
};

function exportFormatForOperation(operation: CadOperation): OnshapeExportFormat | null {
  if (operation === "export_step") return "STEP";
  if (operation === "export_stl") return "STL";
  if (operation === "export_gltf") return "GLTF";
  return null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type OnshapeExportOptionsLegacy = {
  pollMs?: number;
  maxPolls?: number;
  /** Receives the real STL/STEP bytes (vault in the hosted app). Without it only provenance is kept. */
  sink?: CadExportSink;
  elementName?: string;
  title?: string;
  changeNote?: string | null;
};

/**
 * Export a Part Studio. STL and STEP now return the REAL bytes (see
 * onshape-export.ts) and hand them to `options.sink` — the hosted app stores a
 * CAD vault version — so nothing is truncated to a preview any more. glTF still
 * runs through the translation service for provenance only, because the vault
 * has no glTF format.
 */
export async function exportOnshapePartStudio(
  http: OnshapeHttp,
  document: OnshapeDocumentRef,
  format: OnshapeExportFormat,
  options: OnshapeExportOptionsLegacy = {},
): Promise<{ provenance: OnshapeExportProvenance; previewText?: string; file?: OnshapeExportedFile }> {
  const base = `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}`;
  const exportedAt = new Date().toISOString();

  if (format === "STL" || format === "STEP") {
    const file = await exportOnshapeElementFile(http, document, format === "STL" ? "stl" : "step", {
      elementName: options.elementName ?? document.label,
      pollMs: options.pollMs,
      maxPolls: options.maxPolls,
    });
    let storage: OnshapeExportProvenance["storage"] = "metadata_only";
    let vault: OnshapeExportProvenance["vault"];
    let filePath: string | undefined;
    if (options.sink) {
      const destination = await options.sink({
        file,
        title: options.title ?? options.elementName ?? document.label ?? "Part Studio export",
        changeNote: options.changeNote ?? null,
        document,
      });
      if (destination.kind === "vault") {
        storage = "vault";
        vault = {
          documentId: destination.documentId,
          version: destination.version,
          href: destination.href,
          title: destination.title,
          duplicate: destination.duplicate,
        };
      } else {
        storage = "file";
        filePath = destination.path;
      }
    }
    const previewText =
      format === "STL" && looksLikeAsciiStl(file.bytes)
        ? (() => {
            const text = file.bytes.toString("utf8");
            return text.length > 4_000 ? `${text.slice(0, 4_000)}\n…[preview truncated; the full file is stored]` : text;
          })()
        : undefined;
    return {
      provenance: {
        format,
        documentId: document.documentId,
        workspaceId: document.workspaceId,
        elementId: document.elementId,
        ...(file.translationId ? { translationId: file.translationId } : {}),
        requestState: "DONE",
        contentSha256: file.sha256,
        byteLength: file.byteLength,
        exportedAt: file.exportedAt,
        source: "onshape-api",
        storage,
        ...(vault ? { vault } : {}),
        ...(filePath ? { filePath } : {}),
        note:
          storage === "vault"
            ? `${format} saved to the team CAD vault as "${vault!.title}" v${vault!.version}.`
            : storage === "file"
              ? `${format} written to ${filePath}.`
              : `${format} exported (${file.byteLength} bytes, sha256 recorded). No storage sink was attached, so only provenance is kept.`,
      },
      previewText,
      file,
    };
  }

  const response = await http(`${base}/translations`, {
    method: "POST",
    body: JSON.stringify(onshapeTranslationPayload(format, document.documentId)),
  });
  const started = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(started.message ?? started.error ?? `Onshape ${format} translation failed`));
  }
  const translationId = String(started.id ?? started.translationId ?? "");
  if (!translationId) throw new Error("Onshape translation response missing id");

  const pollMs = options.pollMs ?? 1_500;
  const maxPolls = options.maxPolls ?? 40;
  let requestState = String(started.requestState ?? "ACTIVE");
  let resultExternalDataIds: string[] | undefined;
  for (let i = 0; i < maxPolls && requestState !== "DONE" && requestState !== "FAILED"; i++) {
    await sleep(pollMs);
    const poll = await http(`/translations/${translationId}`);
    const body = (await poll.json()) as Record<string, unknown>;
    if (!poll.ok) throw new Error(`Onshape translation poll failed: ${String(body.message ?? poll.status)}`);
    requestState = String(body.requestState ?? "ACTIVE");
    if (Array.isArray(body.resultExternalDataIds)) {
      resultExternalDataIds = body.resultExternalDataIds.map(String);
    }
  }

  if (requestState !== "DONE") {
    throw new Error(`Onshape ${format} export did not finish (state=${requestState}). Retry in a disposable document.`);
  }

  return {
    provenance: {
      format,
      documentId: document.documentId,
      workspaceId: document.workspaceId,
      elementId: document.elementId,
      translationId,
      requestState,
      resultExternalDataIds,
      exportedAt,
      source: "onshape-api",
      storage: "metadata_only",
      note: `${format} translation completed in Onshape. The vault stores STL/STEP only; download glTF from Onshape using translationId.`,
    },
  };
}

type OnshapeMutateResult = {
  featureId?: string;
  exportArtifact?: {
    type: string;
    title: string;
    provenance: OnshapeExportProvenance;
    previewText?: string;
  };
  explain?: ReturnType<typeof explainFeatureTreeForStudents>;
  /** Raw tool result from the shared executor, for the step output column. */
  toolResult?: unknown;
};

type OnshapeTransportLike = {
  mutate(input: {
    operation: CadOperation;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<OnshapeMutateResult>;
  describe(): Promise<{
    fingerprint: string;
    summary: Record<string, unknown>;
    render: string;
    checkpointRef: string;
  }>;
  rollback(checkpointRef: string): Promise<void>;
};

/**
 * Legacy job-step parameters carry unit strings ("25 mm", "1 in"). Accept those
 * and plain numbers; anything else falls through as NaN so the feature builder
 * reports "must be a positive number of millimetres" instead of a silent default.
 */
export function legacyParameterMm(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return value;
  const text = String(value).trim().toLowerCase();
  const match = /^(-?\d+(?:\.\d+)?)\s*(mm|millimet\w*|cm|m|in|inch(?:es)?|")?$/.exec(text);
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  const unit = match[2] ?? "mm";
  if (unit === "cm") return amount * 10;
  if (unit === "m") return amount * 1000;
  if (unit === "in" || unit === '"' || unit.startsWith("inch")) return amount * 25.4;
  return amount;
}

function legacyExtrudeOperation(parameters: Record<string, unknown>): string {
  const raw = String(parameters.operationType ?? parameters.direction ?? parameters.operation ?? "NEW").trim().toLowerCase();
  if (raw === "cut" || raw === "remove") return "REMOVE";
  if (raw === "join" || raw === "add") return "ADD";
  if (raw === "intersect") return "INTERSECT";
  return "NEW";
}

/**
 * Map one legacy CadOperation to the ordered tool calls the shared executor
 * runs. Exported so the mapping is unit-testable without HTTP. Every operation
 * in CAD_OPERATIONS resolves here or in the transport's own export/describe/
 * FeatureScript branches — nothing is declared and then thrown at.
 */
export function legacyOperationToolCalls(
  operation: CadOperation,
  parameters: Record<string, unknown>,
): Array<{ tool: string; args: Record<string, unknown> }> {
  const p = parameters;
  const name = typeof p.name === "string" ? p.name : undefined;
  const plane = typeof p.plane === "string" ? p.plane : undefined;
  const featureId = typeof p.featureId === "string" ? p.featureId : undefined;
  switch (operation) {
    case "create_sketch": {
      const shape = String(p.shape ?? "").toLowerCase();
      if (shape === "circle" || (!shape && (p.diameterMm !== undefined || p.diameter !== undefined))) {
        return [
          {
            tool: "onshape_sketch_circle",
            args: {
              diameterMm: legacyParameterMm(p.diameterMm ?? p.diameter),
              centerXMm: legacyParameterMm(p.centerXMm),
              centerYMm: legacyParameterMm(p.centerYMm),
              plane,
              name,
            },
          },
        ];
      }
      if (shape === "slot") {
        return [
          {
            tool: "onshape_sketch_slot",
            args: {
              lengthMm: legacyParameterMm(p.lengthMm ?? p.length),
              widthMm: legacyParameterMm(p.widthMm ?? p.width),
              centerXMm: legacyParameterMm(p.centerXMm),
              centerYMm: legacyParameterMm(p.centerYMm),
              angleDeg: p.angleDeg,
              plane,
              name,
            },
          },
        ];
      }
      if (shape === "polygon") {
        return [
          {
            tool: "onshape_sketch_polygon",
            args: {
              sides: p.sides,
              acrossFlatsMm: legacyParameterMm(p.acrossFlatsMm),
              circumscribedDiameterMm: legacyParameterMm(p.circumscribedDiameterMm ?? p.diameterMm),
              centerXMm: legacyParameterMm(p.centerXMm),
              centerYMm: legacyParameterMm(p.centerYMm),
              plane,
              name,
            },
          },
        ];
      }
      if (Array.isArray(p.points)) {
        return [{ tool: "onshape_sketch_polyline", args: { points: p.points, closed: p.closed ?? true, plane, name } }];
      }
      return [
        {
          tool: "onshape_sketch_rectangle",
          args: {
            widthMm: legacyParameterMm(p.widthMm ?? p.width),
            heightMm: legacyParameterMm(p.heightMm ?? p.height),
            originXMm: legacyParameterMm(p.originXMm),
            originYMm: legacyParameterMm(p.originYMm),
            plane,
            name,
          },
        },
      ];
    }
    case "create_extrude":
      return [
        {
          tool: "onshape_extrude",
          args: {
            depthMm: legacyParameterMm(p.depthMm ?? p.depth),
            operationType: legacyExtrudeOperation(p),
            sketchFeatureId: p.sketchFeatureId,
            oppositeDirection: p.oppositeDirection,
            name,
          },
        },
      ];
    case "create_fillet":
      return [
        {
          tool: "onshape_fillet",
          args: { radiusMm: legacyParameterMm(p.radiusMm ?? p.radius), selection: p.selection, featureId, plane, name },
        },
      ];
    case "create_chamfer":
      return [
        {
          tool: "onshape_chamfer",
          args: { widthMm: legacyParameterMm(p.widthMm ?? p.distance ?? p.width), selection: p.selection, featureId, plane, name },
        },
      ];
    case "create_shell":
      return [
        {
          tool: "onshape_shell",
          args: {
            thicknessMm: legacyParameterMm(p.thicknessMm ?? p.thickness),
            faces: p.faces ?? "top",
            faceIds: Array.isArray(p.faceIds) ? p.faceIds : undefined,
            featureId,
            plane,
            oppositeDirection: p.oppositeDirection,
            name,
          },
        },
      ];
    case "create_pattern": {
      const instanceCount = p.instanceCount ?? p.count;
      if (typeof p.axisFeatureId === "string" && p.axisFeatureId) {
        return [
          {
            tool: "onshape_circular_pattern",
            args: { instanceCount, axisFeatureId: p.axisFeatureId, featureIds: p.featureIds, angleDeg: p.angleDeg, name },
          },
        ];
      }
      return [
        {
          tool: "onshape_linear_pattern",
          args: {
            instanceCount,
            spacingMm: legacyParameterMm(p.spacingMm ?? p.spacing),
            direction: typeof p.direction === "string" ? p.direction.toUpperCase() : undefined,
            featureIds: p.featureIds,
            oppositeDirection: p.oppositeDirection,
            name,
          },
        },
      ];
    }
    case "set_variable": {
      const variableType = String(p.variableType ?? "LENGTH").toUpperCase();
      const value = variableType === "LENGTH" ? legacyParameterMm(p.value) : Number(p.value);
      return [{ tool: "onshape_set_variable", args: { variableName: p.variableName ?? p.name, value, variableType, name: p.featureName } }];
    }
    case "create_hole": {
      const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
      if (Array.isArray(p.points) || p.gridCountX !== undefined) {
        calls.push({
          tool: "onshape_sketch_points",
          args: {
            points: p.points,
            gridCountX: p.gridCountX,
            gridCountY: p.gridCountY,
            gridPitchXMm: legacyParameterMm(p.gridPitchXMm ?? p.pitch),
            gridPitchYMm: legacyParameterMm(p.gridPitchYMm),
            originXMm: legacyParameterMm(p.originXMm),
            originYMm: legacyParameterMm(p.originYMm),
            plane,
          },
        });
      }
      calls.push({
        tool: "onshape_hole",
        args: {
          diameterMm: legacyParameterMm(p.diameterMm ?? p.diameter),
          endStyle: p.endStyle,
          depthMm: legacyParameterMm(p.depthMm ?? p.depth),
          pointSketchFeatureId: p.pointSketchFeatureId,
          targetFeatureId: p.targetFeatureId,
          name,
        },
      });
      return calls;
    }
    case "create_mirror":
      return [{ tool: "onshape_mirror", args: { plane: plane ?? "Right", featureIds: p.featureIds, name } }];
    case "delete_feature":
      return [{ tool: "onshape_delete_feature", args: { featureId } }];
    default:
      return [];
  }
}

/**
 * Hosted Onshape transport for the job pipeline. Geometry mutations delegate to
 * the SAME executor the /cad agent uses (callClaudeCadTool + onshape-features),
 * so every allowlisted operation builds a real feature; exports hand their bytes
 * to `onExport` (the vault in the hosted app). Real credentials must be tested
 * only in a disposable document.
 */
export function createOnshapeApiTransport(input: {
  http: OnshapeHttp;
  document: OnshapeDocumentRef;
  onExport?: CadExportSink;
}): OnshapeTransportLike {
  let version = 0;
  let lastExport: OnshapeMutateResult["exportArtifact"];
  let lastExplain: ReturnType<typeof explainFeatureTreeForStudents> | undefined;
  const { http, document } = input;
  const base = `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}`;

  // One in-memory session per transport: feature ids created through this job
  // chain to each other (extrude after sketch, fillet after extrude) exactly as
  // they do in the agent, and delete_feature stays limited to what this job added.
  let session: ClaudeCadSession = {
    documentId: document.documentId,
    workspaceId: document.workspaceId,
    elementId: document.elementId,
    documentName: document.label,
    features: [],
    rebuild: 0,
  };
  const runtime: ClaudeCadRuntime = {
    http,
    hosted: true,
    loadSession: async () => session,
    saveSession: async (next) => {
      session = next;
    },
    saveExport: input.onExport,
  };

  return {
    async mutate(args) {
      version += 1;
      const { operation, parameters, idempotencyKey } = args;
      const exportFormat = exportFormatForOperation(operation);
      if (exportFormat) {
        const { provenance, previewText } = await exportOnshapePartStudio(http, document, exportFormat, {
          sink: input.onExport,
          elementName: document.label,
          title: typeof parameters.title === "string" ? parameters.title : undefined,
          changeNote: typeof parameters.changeNote === "string" ? parameters.changeNote : null,
        });
        lastExport = {
          type: `cad_export_${exportFormat.toLowerCase()}`,
          title: `Onshape ${exportFormat} export`,
          provenance,
          previewText,
        };
        return {
          featureId: `export-${exportFormat.toLowerCase()}-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 12)}`,
          exportArtifact: lastExport,
        };
      }
      if (operation === "feature_script") {
        const script = String(parameters.source ?? parameters.script ?? "");
        if (!script || script.length > 20_000) throw new Error("FeatureScript source missing or too large");
        const response = await http(`${base}/featurescript`, {
          method: "POST",
          body: JSON.stringify({
            script,
            queries: [],
            serializationVersion: "1.1.22",
          }),
          headers: { "x-vantage-idempotency": idempotencyKey },
        });
        if (!response.ok) {
          const err = await response.text();
          throw new Error(`Onshape FeatureScript failed: ${err.slice(0, 400)}`);
        }
        return { featureId: `fs-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 12)}` };
      }
      if (operation === "verify_topology" || operation === "render_views" || operation === "create_checkpoint") {
        try {
          const features = await listOnshapeFeatures(http, document);
          lastExplain = explainFeatureTreeForStudents(features);
        } catch {
          lastExplain = undefined;
        }
        return { featureId: `verify-${version}`, explain: lastExplain };
      }
      const calls = legacyOperationToolCalls(operation, parameters);
      if (!calls.length) {
        throw new Error(`Onshape operation '${operation}' has no tool mapping. This is a Vantage bug — CAD_OPERATIONS and legacyOperationToolCalls must agree.`);
      }
      let last: unknown;
      for (const call of calls) {
        last = await callClaudeCadTool(call.tool, call.args, runtime);
      }
      const record = (last ?? {}) as { featureId?: string; deletedFeatureId?: string };
      return { featureId: record.featureId ?? record.deletedFeatureId ?? `onshape-${operation}-${version}`, toolResult: last };
    },
    async describe() {
      let features: OnshapeFeatureSummary[] = [];
      try {
        features = await listOnshapeFeatures(http, document);
        lastExplain = explainFeatureTreeForStudents(features);
      } catch {
        /* mass-only describe still useful when features endpoint is denied */
      }
      const mass = await http(`${base}/massproperties`);
      let summary: Record<string, unknown> = {
        documentId: document.documentId,
        workspaceId: document.workspaceId,
        elementId: document.elementId,
        validation: "onshape-live",
        featureCount: features.length,
        featureTree: features.slice(0, 40),
        studentExplain: lastExplain,
        ...(lastExport ? { lastExport: lastExport.provenance } : {}),
      };
      if (mass.ok) {
        const body = (await mass.json()) as Record<string, unknown>;
        summary = { ...summary, mass: body };
      }
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ summary: { ...summary, studentExplain: undefined }, version }))
        .digest("hex");
      const label = document.label ?? document.elementId;
      return {
        fingerprint,
        summary,
        render: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#0b1115"/><text x="40" y="200" fill="#7dd3fc" font-size="28">Onshape · ${label}</text><text x="40" y="250" fill="#94a3b8" font-size="18">${features.length} features · live describe</text></svg>`,
        checkpointRef: `onshape-cp-${fingerprint.slice(0, 16)}`,
      };
    },
    async rollback(checkpointRef) {
      // Onshape workspace rollback is destructive; require explicit feature_script / UI for now.
      throw new Error(`Rollback of ${checkpointRef} must be confirmed via Onshape UI or reviewed FeatureScript`);
    },
  };
}

export type CadOsSupport = {
  os: "windows" | "macos" | "linux";
  vantageCadCli: "supported";
  fusion360Addin: "supported" | "unsupported";
  fusion360Autodesk: "supported" | "unsupported";
  onshapeHosted: "supported";
  notes: string;
};

export function cadOsSupportMatrix(): CadOsSupport[] {
  return [
    {
      os: "windows",
      vantageCadCli: "supported",
      fusion360Addin: "supported",
      fusion360Autodesk: "supported",
      onshapeHosted: "supported",
      notes: "Full Fusion local relay + Onshape hosted.",
    },
    {
      os: "macos",
      vantageCadCli: "supported",
      fusion360Addin: "supported",
      fusion360Autodesk: "supported",
      onshapeHosted: "supported",
      notes: "Full Fusion local relay + Onshape hosted.",
    },
    {
      os: "linux",
      vantageCadCli: "supported",
      fusion360Addin: "unsupported",
      fusion360Autodesk: "unsupported",
      onshapeHosted: "supported",
      notes: "Autodesk Fusion 360 is not available on Linux. Use Onshape hosted, or VANTAGE_CAD_MOCK=1 for relay protocol tests.",
    },
  ];
}
