/**
 * A small Microsoft Graph client over fetch, for the Excel/OneDrive workbook sync.
 *
 * Deliberately no SDK: we call a dozen endpoints, and every shape relied on below was
 * checked against Microsoft's own reference pages (cited next to each use).
 *
 * OAuth 2.0 authorization-code flow, delegated permissions, Microsoft identity platform v2:
 *   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 *   - authorize: GET https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 *       client_id, response_type=code, redirect_uri, response_mode=query, scope, state,
 *       code_challenge + code_challenge_method=S256 (PKCE, "recommended for all application
 *       types, both public and confidential clients").
 *   - token:     POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token,
 *       application/x-www-form-urlencoded; grant_type=authorization_code with code,
 *       redirect_uri, code_verifier, client_secret; or grant_type=refresh_token.
 *       A refresh response carries "a new OAuth 2.0 refresh token. Replace the old refresh
 *       token with this newly acquired refresh token" — callers persist the rotated token.
 *       `invalid_grant` means the grant is invalid or expired → the user must reconnect.
 *
 * Throttling: https://learn.microsoft.com/en-us/graph/throttling
 *   429 carries Retry-After (seconds). "Wait the number of seconds specified in the
 *   Retry-After header" and retry; with no Retry-After, "implementing an exponential
 *   backoff retry policy". Excel endpoints document that a 504 "is to repeat the request"
 *   (e.g. https://learn.microsoft.com/en-us/graph/api/tablerowcollection-add). So: we retry
 *   429, 503 and 504 only — never a 4xx that would fail identically again.
 */

import { createHash } from "node:crypto";

export const MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const MICROSOFT_LOGIN_BASE = "https://login.microsoftonline.com";

/**
 * Delegated scopes. offline_access → a refresh token (so a sync can run later without the
 * admin present); Files.ReadWrite → create and write the one workbook in their OneDrive;
 * User.Read → show whose account is connected. Nothing tenant-wide, nothing `.All`.
 */
export const MICROSOFT_SCOPES = ["offline_access", "Files.ReadWrite", "User.Read"] as const;

export const MICROSOFT_SETUP_MESSAGE =
  "Connect Microsoft needs a Microsoft app registration — see docs/MICROSOFT_EXCEL.md";

export type MicrosoftConfig = {
  clientId: string;
  clientSecret: string;
  tenant: string;
  redirectUri: string;
  scopes: string[];
};

export function microsoftMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.MICROSOFT_CLIENT_ID?.trim()) missing.push("MICROSOFT_CLIENT_ID");
  if (!env.MICROSOFT_CLIENT_SECRET?.trim()) missing.push("MICROSOFT_CLIENT_SECRET");
  return missing;
}

/**
 * The redirect URI an admin registers on the Azure app. Computed from the deployment URL
 * alone, so the settings card can show it before the app registration exists.
 */
export function microsoftCallbackUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.MICROSOFT_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = (env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${base}/api/integrations/microsoft/callback`;
}

export function getMicrosoftConfig(env: NodeJS.ProcessEnv = process.env): MicrosoftConfig | null {
  if (microsoftMissingEnv(env).length > 0) return null;
  const tenant = env.MICROSOFT_TENANT?.trim() || "common";
  return {
    clientId: env.MICROSOFT_CLIENT_ID!.trim(),
    clientSecret: env.MICROSOFT_CLIENT_SECRET!.trim(),
    // Only the documented tenant forms: common | organizations | consumers | a tenant id/domain.
    tenant: /^[A-Za-z0-9.-]{1,100}$/.test(tenant) ? tenant : "common",
    redirectUri: microsoftCallbackUrl(env),
    scopes: [...MICROSOFT_SCOPES],
  };
}

export type MicrosoftSetupStatus = {
  configured: boolean;
  missingEnv: string[];
  callbackUrl: string;
  scopes: string[];
  message: string | null;
};

export function microsoftSetupStatus(env: NodeJS.ProcessEnv = process.env): MicrosoftSetupStatus {
  const missingEnv = microsoftMissingEnv(env);
  return {
    configured: missingEnv.length === 0,
    missingEnv,
    callbackUrl: microsoftCallbackUrl(env),
    scopes: [...MICROSOFT_SCOPES],
    message: missingEnv.length === 0 ? null : MICROSOFT_SETUP_MESSAGE,
  };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildMicrosoftAuthorizeUrl(config: MicrosoftConfig, state: string, codeVerifier: string): string {
  const url = new URL(`${MICROSOFT_LOGIN_BASE}/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkceChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Let the admin pick which Microsoft account (school vs personal) owns the workbook.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

// ------------------------------------------------------------------ errors

export type GraphErrorKind =
  | "auth_expired"
  | "throttled"
  | "not_found"
  | "conflict"
  | "unavailable"
  | "forbidden"
  | "bad_request";

/**
 * One error type for everything the Graph and token endpoints can say. The message is
 * built from Microsoft's error `code`/`message` fields only — never from request bodies,
 * so an access or refresh token can never end up in a log line or a stored error.
 */
export class GraphError extends Error {
  constructor(
    readonly kind: GraphErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export function isGraphError(error: unknown): error is GraphError {
  return error instanceof GraphError;
}

function kindForStatus(status: number): GraphErrorKind {
  if (status === 401) return "auth_expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409 || status === 412) return "conflict";
  if (status === 429) return "throttled";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

/** Plain words for the settings card — what happened and what to do. */
export function describeGraphError(error: unknown): string {
  if (!isGraphError(error)) {
    return "The sync stopped unexpectedly. Try again; if it keeps failing, disconnect and reconnect Microsoft.";
  }
  switch (error.kind) {
    case "auth_expired":
      return "Microsoft sign-in expired or was revoked. An owner or admin needs to reconnect Microsoft.";
    case "throttled":
      return "Microsoft asked Vantage to slow down. Wait a few minutes and sync again.";
    case "not_found":
      return "The workbook could not be found in OneDrive. It may have been deleted or moved; syncing again recreates it.";
    case "conflict":
      return "The workbook changed while Vantage was writing to it. Close it in Excel if it is open for editing, then sync again.";
    case "unavailable":
      return "Microsoft 365 did not answer in time. Try again in a few minutes.";
    case "forbidden":
      return "Microsoft refused access to the workbook. Check the connected account can edit files in its OneDrive, then reconnect.";
    default:
      return `Microsoft rejected the request (${error.code ?? error.status ?? "unknown"}).`;
  }
}

// ------------------------------------------------------------------ retry

export type RetryOptions = {
  /** Total attempts including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** A Retry-After longer than this is not waited out: the call fails as throttled. */
  maxRetryAfterMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  fetchImpl?: typeof fetch;
};

const RETRYABLE_STATUS = new Set([429, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry-After is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/** Exponential backoff with full jitter: random(0, min(max, base * 2^(attempt-1))). */
export function backoffDelayMs(attempt: number, base: number, max: number, random: () => number): number {
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

/**
 * fetch with a per-request timeout and retries for 429/503/504 only. Returns the final
 * Response (which may still be an error status) — the caller turns it into a GraphError.
 * A timeout or network failure is not retried here: it becomes `unavailable` at once,
 * because a write that timed out may have landed, and blindly repeating an append would
 * duplicate rows.
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions = {}): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 1; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      const timedOut = controller.signal.aborted;
      throw new GraphError(
        "unavailable",
        timedOut ? `Microsoft did not answer within ${Math.round(timeoutMs / 1000)}s.` : "Could not reach Microsoft.",
        null,
        timedOut ? "timeout" : "network",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxAttempts) return response;

    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    if (retryAfter !== null && retryAfter > maxRetryAfterMs) return response;
    const delay = retryAfter ?? backoffDelayMs(attempt, baseDelayMs, maxDelayMs, random);
    // Drain the body so the connection can be reused.
    await response.arrayBuffer().catch(() => undefined);
    await sleep(delay);
  }
}

async function errorFromResponse(response: Response): Promise<GraphError> {
  let code: string | null = null;
  let message = `Microsoft Graph returned HTTP ${response.status}.`;
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown } | string;
      error_description?: unknown;
    };
    if (body && typeof body.error === "object" && body.error) {
      code = typeof body.error.code === "string" ? body.error.code : null;
      if (typeof body.error.message === "string" && body.error.message) message = body.error.message.slice(0, 300);
    } else if (typeof body?.error === "string") {
      // Token endpoint shape: { error, error_description }.
      code = body.error;
      if (typeof body.error_description === "string") message = body.error_description.split(/\r?\n/)[0]!.slice(0, 300);
    }
  } catch {
    // Non-JSON body: keep the status message.
  }
  let kind = kindForStatus(response.status);
  // Token endpoint: an expired/revoked refresh token or missing consent means "reconnect".
  if (code && ["invalid_grant", "interaction_required", "consent_required", "login_required"].includes(code)) {
    kind = "auth_expired";
  }
  if (code === "temporarily_unavailable") kind = "unavailable";
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  return new GraphError(kind, message, response.status, code, retryAfterMs);
}

// ------------------------------------------------------------------ tokens

export type MicrosoftTokens = {
  accessToken: string;
  /** Present when offline_access was granted. On refresh, may be a NEW token that replaces the old. */
  refreshToken: string | null;
  expiresInSeconds: number;
  scope: string | null;
};

async function tokenRequest(
  config: MicrosoftConfig,
  params: Record<string, string>,
  options: RetryOptions,
): Promise<MicrosoftTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scopes.join(" "),
    ...params,
  });
  const response = await fetchWithRetry(
    `${MICROSOFT_LOGIN_BASE}/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    },
    options,
  );
  if (!response.ok) throw await errorFromResponse(response);
  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new GraphError("unavailable", "Microsoft returned no access token.", response.status, "no_access_token");
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null,
    expiresInSeconds: Number(data.expires_in) || 3600,
    scope: typeof data.scope === "string" ? data.scope : null,
  };
}

export function exchangeMicrosoftCode(
  config: MicrosoftConfig,
  code: string,
  codeVerifier: string,
  options: RetryOptions = {},
): Promise<MicrosoftTokens> {
  return tokenRequest(
    config,
    { grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: codeVerifier },
    options,
  );
}

export async function refreshMicrosoftTokens(
  config: MicrosoftConfig,
  refreshToken: string,
  options: RetryOptions = {},
): Promise<MicrosoftTokens> {
  const tokens = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }, options);
  // Microsoft usually rotates; if it did not, the old token stays valid.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

// ------------------------------------------------------------------ client

export type GraphRequestOptions = {
  body?: unknown;
  /** Raw bytes (file upload). Mutually exclusive with `body`. */
  raw?: Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
};

export class GraphClient {
  /** Sent as `workbook-session-id` on every request once set (see workbook-target). */
  sessionId: string | null = null;
  private readonly baseUrl: string;

  constructor(
    private readonly accessToken: string,
    private readonly retry: RetryOptions = {},
    baseUrl = MICROSOFT_GRAPH_BASE,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** Every request made, for tests and for the "keep Graph calls minimal" budget. */
  requestCount = 0;

  async request<T = unknown>(method: string, path: string, options: GraphRequestOptions = {}): Promise<T | null> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.accessToken}`,
      accept: "application/json",
      ...options.headers,
    };
    if (this.sessionId) headers["workbook-session-id"] = this.sessionId;
    let body: BodyInit | undefined;
    if (options.raw) {
      headers["content-type"] = options.contentType ?? "application/octet-stream";
      body = options.raw as unknown as BodyInit;
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    this.requestCount += 1;
    const response = await fetchWithRetry(`${this.baseUrl}${path}`, { method, headers, body }, this.retry);
    if (!response.ok) throw await errorFromResponse(response);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
