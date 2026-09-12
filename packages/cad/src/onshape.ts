import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CadOperation } from "./agent-policy";
import {
  addOnshapeAssemblyInstance,
  createOnshapeAssembly,
  createOnshapeMate,
  annotateOnshapeDrawing,
  createOnshapeDrawing,
  createOnshapeDrawingViews,
  createOnshapePartStudio,
  getOnshapeAssembly,
  type OnshapeAssemblyRef,
  type OnshapeMateType,
} from "./onshape-assemblies";
import {
  circleSketchFeature,
  extrudeFeature,
  onshapeFeaturePath,
  parseAddedFeatureId,
  parseSketchPointsMm,
  pointsSketchFeature,
  polylineSketchFeature,
  rectangleSketchFeature,
} from "./onshape-features";
import { firstPlannedId } from "./first-planned-id";
import {
  dispatchOnshapeNativeFeature,
  isOnshapeNativeOperation,
  isOnshapeNativeUnimplemented,
  onshapeNativeUnimplementedError,
} from "./onshape-native-dispatch";

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

/**
 * The callback URL an admin must register in the Onshape developer portal.
 *
 * Deliberately computed WITHOUT the client id/secret: an admin who has not set
 * them yet is exactly the person who needs to know which URL to paste into the
 * OAuth application before they can produce those credentials. `redirectUri` on
 * the config stays null-when-unconfigured, because a live `redirectUri` is what
 * the Connect button treats as "OAuth is usable".
 */
export function onshapeCallbackUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ONSHAPE_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = (env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${base}/api/cad/onshape/oauth/callback`;
}

export function onshapeMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.ONSHAPE_OAUTH_CLIENT_ID?.trim()) missing.push("ONSHAPE_OAUTH_CLIENT_ID");
  if (!env.ONSHAPE_OAUTH_CLIENT_SECRET?.trim()) missing.push("ONSHAPE_OAUTH_CLIENT_SECRET");
  return missing;
}

export function getOnshapeOAuthConfig(env: NodeJS.ProcessEnv = process.env): OnshapeOAuthConfig | null {
  if (!isOnshapeOAuthConfigured(env)) return null;
  return {
    clientId: env.ONSHAPE_OAUTH_CLIENT_ID!.trim(),
    clientSecret: env.ONSHAPE_OAUTH_CLIENT_SECRET!.trim(),
    redirectUri: onshapeCallbackUrl(env),
    scopes: (env.ONSHAPE_OAUTH_SCOPES?.trim() || ONSHAPE_DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
  };
}

export function onshapeSetupStatus(env: NodeJS.ProcessEnv = process.env) {
  const configured = isOnshapeOAuthConfigured(env);
  const config = configured ? getOnshapeOAuthConfig(env) : null;
  const callbackUrl = onshapeCallbackUrl(env);
  const missingEnv = onshapeMissingEnv(env);
  return {
    configured,
    setupRequired: !configured,
    redirectUri: config?.redirectUri ?? null,
    /** Always present — the URL to register even before the client exists. */
    callbackUrl,
    missingEnv,
    scopes: config?.scopes ?? [...ONSHAPE_DEFAULT_SCOPES],
    message: configured
      ? `Onshape OAuth client is configured. Users can connect in CAD Connections. Registered callback URL: ${callbackUrl}`
      : `Setup required — set ${missingEnv.join(" and ")} in your deployment environment (Vercel → Project → Settings → Environment Variables), then redeploy. Register this exact callback URL on the Onshape OAuth application (dev-portal.onshape.com → OAuth applications): ${callbackUrl}`,
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

export type OnshapeSessionInfo = { id: string; name: string | null; email: string | null };

/**
 * Who the freshly minted token belongs to, so Connections can say "Connected as
 * jane@team.org" instead of echoing the Vantage user id back at the student.
 *
 * Returns null rather than throwing: a connection whose account lookup 404s or
 * rate-limits is still a working connection, and failing the OAuth callback over
 * a cosmetic label would be worse than an unlabelled row.
 */
export async function fetchOnshapeSessionInfo(http: OnshapeHttp): Promise<OnshapeSessionInfo | null> {
  try {
    const response = await http("/users/sessioninfo");
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    const id = data.id ? String(data.id) : "";
    if (!id) return null;
    return {
      id,
      name: data.name ? String(data.name) : null,
      email: data.email ? String(data.email) : null,
    };
  } catch {
    return null;
  }
}

/** `onshape:<email|name|id>` — the value stored in cad_connections.external_account_ref. */
export function onshapeAccountRef(info: OnshapeSessionInfo | null, fallbackUserId: string): string {
  const label = info?.email?.trim() || info?.name?.trim() || info?.id?.trim();
  return `onshape:${label || fallbackUserId}`;
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
  storage: "metadata_only" | "inline_preview";
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

/**
 * Export Part Studio via Onshape translations (STEP/GLTF) or sync STL.
 * Stores provenance metadata suitable for cad_artifacts — not giant binaries in Postgres.
 */
export async function exportOnshapePartStudio(
  http: OnshapeHttp,
  document: OnshapeDocumentRef,
  format: OnshapeExportFormat,
  options: { pollMs?: number; maxPolls?: number } = {},
): Promise<{ provenance: OnshapeExportProvenance; previewText?: string }> {
  const base = `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}`;
  const exportedAt = new Date().toISOString();

  if (format === "STL") {
    const response = await http(`${base}/stl?mode=text&grouping=true&scale=1&units=millimeter`);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Onshape STL export failed: ${err.slice(0, 400)}`);
    }
    const text = await response.text();
    const contentSha256 = createHash("sha256").update(text).digest("hex");
    const previewText = text.length > 4_000 ? `${text.slice(0, 4_000)}\n…[truncated]` : text;
    return {
      provenance: {
        format,
        documentId: document.documentId,
        workspaceId: document.workspaceId,
        elementId: document.elementId,
        requestState: "DONE",
        contentSha256,
        byteLength: Buffer.byteLength(text, "utf8"),
        exportedAt,
        source: "onshape-api",
        storage: "inline_preview",
        note: "STL text exported synchronously. Full file checksum recorded; preview may be truncated in team artifacts.",
      },
      previewText,
    };
  }

  const response = await http(`${base}/translations`, {
    method: "POST",
    body: JSON.stringify({
      formatName: format,
      storeInDocument: false,
      translate: true,
      ...(format === "GLTF" ? { linkDocumentId: document.documentId } : {}),
    }),
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
      note: `${format} translation completed in Onshape. Download via Onshape external data / UI using translationId; Vantage stores provenance + IDs, not the binary blob.`,
    },
  };
}

type OnshapeMutateResult = {
  featureId?: string;
  featureScriptUsed?: boolean;
  exportArtifact?: {
    type: string;
    title: string;
    provenance: OnshapeExportProvenance;
    previewText?: string;
  };
  explain?: ReturnType<typeof explainFeatureTreeForStudents>;
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
 * Hosted Onshape transport: allowlisted mutations + describe/verify + STEP/STL/GLTF export provenance.
 * Sketch/extrude map to documented Part Studio feature APIs. FeatureScript is refused.
 * Real credentials must be tested only in a disposable document.
 */
export function createOnshapeApiTransport(input: {
  http: OnshapeHttp;
  document: OnshapeDocumentRef;
}): OnshapeTransportLike {
  let version = 0;
  let lastExport: OnshapeMutateResult["exportArtifact"];
  let lastExplain: ReturnType<typeof explainFeatureTreeForStudents> | undefined;
  let lastAssembly: OnshapeAssemblyRef | null = null;
  let lastPartStudio: OnshapeDocumentRef | null = null;
  const { http, document } = input;

  function jobSketchName(idempotencyKey: string): string {
    const jobKey = idempotencyKey.split(":")[0] || idempotencyKey;
    return `VantageSketch-${createHash("sha256").update(jobKey).digest("hex").slice(0, 10)}`;
  }

  function positiveMillimetres(
    parameters: Record<string, unknown>,
    names: string[],
    label: string,
  ): number {
    const raw = names.map((name) => parameters[name]).find((value) => value !== undefined);
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} must be a positive number in millimetres; no geometry was created`);
    }
    return value;
  }

  async function addFeature(payload: unknown, idempotencyKey: string): Promise<string> {
    const response = await http(onshapeFeaturePath(document), {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "x-vantage-idempotency": idempotencyKey },
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text.slice(0, 400) };
    }
    if (!response.ok) {
      const detail =
        body && typeof body === "object"
          ? String((body as Record<string, unknown>).message ?? text)
          : text;
      throw new Error(`Onshape feature creation failed (HTTP ${response.status}): ${detail.slice(0, 400)}`);
    }
    return parseAddedFeatureId(body);
  }

  return {
    async mutate(args) {
      version += 1;
      const { operation, parameters, idempotencyKey } = args;
      const exportFormat = exportFormatForOperation(operation);
      if (exportFormat) {
        const { provenance, previewText } = await exportOnshapePartStudio(http, document, exportFormat);
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
        throw new Error(
          "FeatureScript is not allowed on hosted Onshape. Use native sketch, extrude, fillet, hole, or mate.",
        );
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
      if (operation === "create_assembly") {
        const created = await createOnshapeAssembly(http, {
          documentId: document.documentId,
          workspaceId: document.workspaceId,
          name: String(parameters.name ?? "").trim(),
        });
        lastAssembly = {
          documentId: document.documentId,
          workspaceId: document.workspaceId,
          elementId: created.elementId,
        };
        return { featureId: created.elementId };
      }
      if (operation === "create_part_studio") {
        const created = await createOnshapePartStudio(http, {
          documentId: document.documentId,
          workspaceId: document.workspaceId,
          name: String(parameters.name ?? "").trim(),
        });
        lastPartStudio = { ...document, elementId: created.elementId, label: created.name };
        return { featureId: created.elementId };
      }
      if (operation === "create_drawing") {
        const created = await createOnshapeDrawing(http, {
          documentId: document.documentId,
          workspaceId: document.workspaceId,
          name: String(parameters.name ?? "Detail drawing").trim() || "Detail drawing",
        });
        const views = Array.isArray(parameters.views)
          ? parameters.views.map((view) => String(view).trim()).filter(Boolean)
          : [];
        if (views.length) {
          await createOnshapeDrawingViews(http, {
            documentId: document.documentId,
            workspaceId: document.workspaceId,
            elementId: created.elementId,
            views,
          });
        }
        const notes = Array.isArray(parameters.notes)
          ? parameters.notes.map((note) => String(note).trim()).filter(Boolean)
          : [];
        const callouts = Array.isArray(parameters.callouts)
          ? parameters.callouts.flatMap((entry) => {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
              const record = entry as Record<string, unknown>;
              const valueMm = Number(record.valueMm);
              const label = String(record.label ?? "").trim();
              if (!label || !Number.isFinite(valueMm) || valueMm <= 0) return [];
              return [{ label, valueMm, view: record.view ? String(record.view) : undefined }];
            })
          : [];
        if (notes.length || callouts.length) {
          await annotateOnshapeDrawing(http, {
            documentId: document.documentId,
            workspaceId: document.workspaceId,
            elementId: created.elementId,
            notes,
            callouts,
          });
        }
        return { featureId: created.elementId };
      }
      if (operation === "label_drawing") {
        const drawingElementId = String(parameters.drawingElementId ?? parameters.elementId ?? "").trim();
        if (!drawingElementId) {
          throw new Error("Label drawing needs the Onshape drawing tab id. Do not invent an id.");
        }
        const notes = Array.isArray(parameters.notes)
          ? parameters.notes.map((note) => String(note).trim()).filter(Boolean)
          : [];
        const callouts = Array.isArray(parameters.callouts)
          ? parameters.callouts.flatMap((entry) => {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
              const record = entry as Record<string, unknown>;
              const valueMm = Number(record.valueMm);
              const label = String(record.label ?? "").trim();
              if (!label || !Number.isFinite(valueMm) || valueMm <= 0) return [];
              return [{ label, valueMm, view: record.view ? String(record.view) : undefined }];
            })
          : [];
        const labeled = await annotateOnshapeDrawing(http, {
          documentId: document.documentId,
          workspaceId: document.workspaceId,
          elementId: drawingElementId,
          notes,
          callouts,
        });
        return { featureId: labeled.elementId };
      }
      if (operation === "add_assembly_instance") {
        const assemblyElementId = String(parameters.assemblyElementId ?? "").trim();
        lastAssembly = {
          documentId: document.documentId,
          workspaceId: document.workspaceId,
          elementId: assemblyElementId,
        };
        const inserted = await addOnshapeAssemblyInstance(http, {
          assembly: lastAssembly,
          sourceDocumentId: String(parameters.sourceDocumentId ?? document.documentId),
          sourceElementId: String(parameters.sourceElementId ?? document.elementId),
          partId: parameters.partId ? String(parameters.partId) : undefined,
          isAssembly: Boolean(parameters.isAssembly),
        });
        return { featureId: inserted.instanceId };
      }
      if (operation === "create_mate") {
        const assemblyElementId = String(parameters.assemblyElementId ?? "").trim();
        lastAssembly = {
          documentId: document.documentId,
          workspaceId: document.workspaceId,
          elementId: assemblyElementId,
        };
        const mate = await createOnshapeMate(http, {
          assembly: lastAssembly,
          name: parameters.name ? String(parameters.name) : undefined,
          mateType: String(parameters.mateType ?? "").toUpperCase() as OnshapeMateType,
          firstInstanceId: firstPlannedId(parameters.firstInstanceId),
          secondInstanceId: firstPlannedId(parameters.secondInstanceId),
          firstFaceId: firstPlannedId(parameters.firstFaceId),
          secondFaceId: firstPlannedId(parameters.secondFaceId),
          firstFlipPrimary: Boolean(parameters.firstFlipPrimary),
          secondFlipPrimary: Boolean(parameters.secondFlipPrimary),
          firstOffsetXMm: Number(parameters.firstOffsetXMm ?? 0),
          firstOffsetYMm: Number(parameters.firstOffsetYMm ?? 0),
          firstOffsetZMm: Number(parameters.firstOffsetZMm ?? 0),
          secondOffsetXMm: Number(parameters.secondOffsetXMm ?? 0),
          secondOffsetYMm: Number(parameters.secondOffsetYMm ?? 0),
          secondOffsetZMm: Number(parameters.secondOffsetZMm ?? 0),
          ...(parameters.minLimit !== undefined ? { minLimit: Number(parameters.minLimit) } : {}),
          ...(parameters.maxLimit !== undefined ? { maxLimit: Number(parameters.maxLimit) } : {}),
        });
        return { featureId: mate.mateFeatureId };
      }
      if (operation === "create_sketch" || operation === "create_extrude") {
        if (operation === "create_sketch") {
          const plane = String(parameters.plane ?? "Top").trim() || "Top";
          const name = String(parameters.name ?? jobSketchName(idempotencyKey)).trim();
          const sketchKind = String(parameters.sketchKind ?? "").trim().toLowerCase();
          if (sketchKind === "circle") {
            const radiusMm = positiveMillimetres(parameters, ["radiusMm", "radius"], "Sketch radius");
            const circle: { diameterMm: number; centerXMm?: number; centerYMm?: number } = {
              diameterMm: radiusMm * 2,
            };
            const centerX = Number(parameters.centerXMm);
            const centerY = Number(parameters.centerYMm);
            if (parameters.centerXMm !== undefined && Number.isFinite(centerX)) circle.centerXMm = centerX;
            if (parameters.centerYMm !== undefined && Number.isFinite(centerY)) circle.centerYMm = centerY;
            const featureId = await addFeature(
              circleSketchFeature({ circles: [circle], plane, name }),
              idempotencyKey,
            );
            return { featureId, featureScriptUsed: false };
          }
          if (sketchKind === "polyline") {
            const points = parseSketchPointsMm(parameters.points);
            if (points.length < 2) {
              throw new Error("Polyline sketches need at least two millimetre points (xMm, yMm).");
            }
            const featureId = await addFeature(
              polylineSketchFeature({
                points,
                closed: parameters.closed !== false,
                plane,
                name,
              }),
              idempotencyKey,
            );
            return { featureId, featureScriptUsed: false };
          }
          if (sketchKind === "points") {
            const points = parseSketchPointsMm(parameters.points);
            if (!points.length) {
              throw new Error("Point sketches need at least one millimetre point (xMm, yMm).");
            }
            const featureId = await addFeature(
              pointsSketchFeature({ points, plane, name }),
              idempotencyKey,
            );
            return { featureId, featureScriptUsed: false };
          }
          const widthMm = positiveMillimetres(parameters, ["widthMm", "width"], "Sketch width");
          const heightMm = positiveMillimetres(parameters, ["heightMm", "height"], "Sketch height");
          const featureId = await addFeature(
            rectangleSketchFeature({ widthMm, heightMm, plane, name }),
            idempotencyKey,
          );
          return { featureId, featureScriptUsed: false };
        }

        const depthMm = positiveMillimetres(parameters, ["depthMm", "depth"], "Extrude depth");
        let sketchFeatureId = firstPlannedId(parameters.sketchFeatureId);
        if (!sketchFeatureId) {
          const expectedName = jobSketchName(idempotencyKey);
          const features = await listOnshapeFeatures(http, document);
          sketchFeatureId =
            [...features]
              .reverse()
              .find(
                (feature) =>
                  feature.name === expectedName &&
                  /sketch/i.test(feature.featureType) &&
                  !feature.suppressed,
              )?.id ?? "";
        }
        if (!sketchFeatureId) {
          throw new Error(
            "Extrude requires sketchFeatureId (or a Vantage sketch from the same job); no geometry was created",
          );
        }
        const operationType = String(parameters.operationType ?? "NEW").toUpperCase();
        if (!["NEW", "ADD", "REMOVE", "INTERSECT"].includes(operationType)) {
          throw new Error(`Unsupported extrude operationType '${operationType}'`);
        }
        const featureId = await addFeature(
          extrudeFeature({
            depthMm,
            sketchFeatureId,
            operationType: operationType as "NEW" | "ADD" | "REMOVE" | "INTERSECT",
            oppositeDirection: Boolean(parameters.oppositeDirection),
            name: String(parameters.name ?? "VantageExtrude").trim() || "VantageExtrude",
          }),
          idempotencyKey,
        );
        return { featureId, featureScriptUsed: false };
      }
      if (isOnshapeNativeUnimplemented(operation)) {
        throw onshapeNativeUnimplementedError(operation);
      }
      if (isOnshapeNativeOperation(operation)) {
        return dispatchOnshapeNativeFeature({
          http,
          document,
          operation,
          parameters,
          idempotencyKey,
        });
      }
      throw onshapeNativeUnimplementedError(operation);
    },
    async describe() {
      if (lastAssembly) {
        const assembly = await getOnshapeAssembly(http, lastAssembly);
        const summary = {
          validation: "onshape-live-assembly",
          documentId: lastAssembly.documentId,
          workspaceId: lastAssembly.workspaceId,
          elementId: lastAssembly.elementId,
          assembly,
        };
        const fingerprint = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
        return {
          fingerprint,
          summary,
          render: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#0b1115"/><text x="40" y="215" fill="#7dd3fc" font-size="28">Onshape Assembly · ${lastAssembly.elementId}</text></svg>`,
          checkpointRef: `onshape-assembly-${fingerprint.slice(0, 16)}`,
        };
      }
      const partStudio = lastPartStudio ?? document;
      const describeBase = `/partstudios/d/${partStudio.documentId}/w/${partStudio.workspaceId}/e/${partStudio.elementId}`;
      let features: OnshapeFeatureSummary[] = [];
      try {
        features = await listOnshapeFeatures(http, partStudio);
        lastExplain = explainFeatureTreeForStudents(features);
      } catch {
        /* mass-only describe still useful when features endpoint is denied */
      }
      const mass = await http(`${describeBase}/massproperties`);
      let summary: Record<string, unknown> = {
        documentId: partStudio.documentId,
        workspaceId: partStudio.workspaceId,
        elementId: partStudio.elementId,
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
      const label = partStudio.label ?? partStudio.elementId;
      return {
        fingerprint,
        summary,
        render: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#0b1115"/><text x="40" y="200" fill="#7dd3fc" font-size="28">Onshape · ${label}</text><text x="40" y="250" fill="#94a3b8" font-size="18">${features.length} features · live describe</text></svg>`,
        checkpointRef: `onshape-cp-${fingerprint.slice(0, 16)}`,
      };
    },
    async rollback(checkpointRef) {
      throw new Error(
        `Rollback of ${checkpointRef} is not a native Onshape action in Vantage`,
      );
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
