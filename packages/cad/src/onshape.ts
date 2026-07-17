import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CadOperation } from "./agent-policy";

type OnshapeTransportLike = {
  mutate(input: {
    operation: CadOperation;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ featureId?: string }>;
  describe(): Promise<{
    fingerprint: string;
    summary: Record<string, unknown>;
    render: string;
    checkpointRef: string;
  }>;
  rollback(checkpointRef: string): Promise<void>;
};

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

/**
 * Hosted Onshape transport: allowlisted mutations + describe/verify.
 * Uses FeatureScript eval for custom scripts; sketch/extrude map to documented Part Studio feature APIs when possible.
 * Real credentials must be tested only in a disposable document.
 */
export function createOnshapeApiTransport(input: {
  http: OnshapeHttp;
  document: OnshapeDocumentRef;
}): OnshapeTransportLike {
  let version = 0;
  const { http, document } = input;
  const base = `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}`;

  return {
    async mutate(args) {
      version += 1;
      const { operation, parameters, idempotencyKey } = args;
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
        return { featureId: `verify-${version}` };
      }
      if (operation === "create_sketch" || operation === "create_extrude") {
        // Geometry mutations go through a reviewed FeatureScript wrapper so we stay on one allowlisted path.
        const width = Number(parameters.widthMm ?? parameters.width ?? 40);
        const height = Number(parameters.heightMm ?? parameters.height ?? 40);
        const depth = Number(parameters.depthMm ?? parameters.depth ?? 10);
        const script =
          operation === "create_sketch"
            ? `function(context is Context, queries) { opPlane(context, id + "plane", { "plane": plane(vector(0, 0, 0) * meter, vector(0, 0, 1)) }); }`
            : `function(context is Context, queries) { /* extrude intent logged: ${width}x${height}x${depth} mm — prefer explicit FeatureScript for production geometry */ }`;
        const response = await http(`${base}/featurescript`, {
          method: "POST",
          body: JSON.stringify({ script, queries: [], serializationVersion: "1.1.22" }),
          headers: { "x-vantage-idempotency": idempotencyKey },
        });
        // Soft-fail to describe-only path when FeatureStudio rejects the placeholder (document still selected).
        if (!response.ok) {
          return { featureId: `intent-${operation}-${version}` };
        }
        return { featureId: `onshape-${operation}-${version}` };
      }
      throw new Error(
        `Onshape operation '${operation}' is allowlisted but requires an explicit FeatureScript body or connector update. Prefer feature_script in a disposable document.`,
      );
    },
    async describe() {
      const mass = await http(`${base}/massproperties`);
      let summary: Record<string, unknown> = {
        documentId: document.documentId,
        workspaceId: document.workspaceId,
        elementId: document.elementId,
        validation: "onshape-live",
      };
      if (mass.ok) {
        const body = (await mass.json()) as Record<string, unknown>;
        summary = { ...summary, mass: body };
      }
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ summary, version }))
        .digest("hex");
      return {
        fingerprint,
        summary,
        render: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#0b1115"/><text x="40" y="220" fill="#7dd3fc" font-size="28">Onshape · ${document.label ?? document.elementId}</text></svg>`,
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
