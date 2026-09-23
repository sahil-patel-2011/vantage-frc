/**
 * Google Sheets for the spreadsheet mirror: configuration, OAuth, and one small HTTP client.
 *
 * Reuses the Google OAuth client Vantage already signs people in with (GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET). Two things an owner has to do once in Google Cloud, both reported
 * on the Connectors card until they are done:
 *   - enable the Google Sheets API on that project;
 *   - add this deployment's callback (googleSheetsCallbackUrl) as an authorized redirect URI.
 *
 * Scope is `drive.file`: Vantage can create a spreadsheet and edit the ones it created,
 * and nothing else in the account's Drive. `openid email profile` name the account on
 * the card.
 *
 * Errors are built from Google's `status`/`message` fields only — never from a request
 * body — so a token can never reach a log line or a stored error.
 */

import { backoffDelayMs, parseRetryAfter } from "../microsoft/graph";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const GOOGLE_SHEETS_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export type GoogleSheetsConfig = { clientId: string; clientSecret: string; redirectUri: string };

export const GOOGLE_SHEETS_SETUP_MESSAGE =
  "Google Sheets is not set up on this server yet: it needs the Google sign-in client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).";

export function googleSheetsMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID?.trim()) missing.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET?.trim()) missing.push("GOOGLE_CLIENT_SECRET");
  return missing;
}

/** The origin whose sign-in callback is registered on the Google client (see @vantage/core access-policy). */
export const GOOGLE_SIGN_IN_CALLBACK_ORIGIN = "https://vantage-frc-web.vercel.app";

/**
 * Where Google sends the owner back. Google only redirects to URIs listed on the OAuth
 * client, so on Vercel this is the one already registered for sign-in —
 * <GOOGLE_OAUTH_CALLBACK_ORIGIN>/api/auth/callback/google — and proxy.ts hands callbacks
 * that carry a Sheets state to /api/integrations/google/callback. No extra registration.
 *
 * GOOGLE_SHEETS_REDIRECT_URI overrides it (a deployment that registered its own URI);
 * `next dev` uses its own route on localhost.
 */
export function googleSheetsCallbackUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.GOOGLE_SHEETS_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  if (env.VERCEL === "1" || env.NODE_ENV === "production") {
    const origin = (env.GOOGLE_OAUTH_CALLBACK_ORIGIN?.trim() || GOOGLE_SIGN_IN_CALLBACK_ORIGIN).replace(/\/$/, "");
    return `${origin}/api/auth/callback/google`;
  }
  const base = (env.BETTER_AUTH_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3001").trim().replace(/\/$/, "");
  return `${base}/api/integrations/google/callback`;
}

export function getGoogleSheetsConfig(env: NodeJS.ProcessEnv = process.env): GoogleSheetsConfig | null {
  if (googleSheetsMissingEnv(env).length) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID!.trim(),
    clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
    redirectUri: googleSheetsCallbackUrl(env),
  };
}

export type GoogleSheetsSetupStatus = {
  configured: boolean;
  missingEnv: string[];
  callbackUrl: string;
  message: string | null;
};

export function googleSheetsSetupStatus(env: NodeJS.ProcessEnv = process.env): GoogleSheetsSetupStatus {
  const missingEnv = googleSheetsMissingEnv(env);
  return {
    configured: missingEnv.length === 0,
    missingEnv,
    callbackUrl: googleSheetsCallbackUrl(env),
    message: missingEnv.length ? GOOGLE_SHEETS_SETUP_MESSAGE : null,
  };
}

export function buildGoogleAuthorizeUrl(config: GoogleSheetsConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SHEETS_SCOPES.join(" "),
    // A refresh token, every time: without `consent` Google omits it on a second connect.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

// ------------------------------------------------------------------ errors

export type GoogleErrorKind =
  | "auth_expired"
  | "throttled"
  | "not_found"
  | "api_disabled"
  | "forbidden"
  | "unavailable"
  | "bad_request";

export class GoogleSheetsError extends Error {
  constructor(
    readonly kind: GoogleErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GoogleSheetsError";
  }
}

export function isGoogleSheetsError(error: unknown): error is GoogleSheetsError {
  return error instanceof GoogleSheetsError;
}

/** Plain words for the Connectors card — what happened and what to do. */
export function describeGoogleError(error: unknown): string {
  if (!isGoogleSheetsError(error)) {
    return "The Google Sheets sync stopped unexpectedly. Try again; if it keeps failing, disconnect and reconnect Google.";
  }
  switch (error.kind) {
    case "auth_expired":
      return "Google sign-in expired or was revoked. An owner or admin needs to reconnect Google Sheets.";
    case "throttled":
      return "Google asked Vantage to slow down. The Excel copy keeps working; Google catches up on the next sync.";
    case "not_found":
      return "The Google spreadsheet could not be found. It may have been deleted; syncing again recreates it.";
    case "api_disabled":
      return "The Google Sheets API is not enabled on this server's Google Cloud project. An owner of that project needs to enable it.";
    case "forbidden":
      return "Google refused access to the spreadsheet. Reconnect Google Sheets and allow Vantage to create and edit its own files.";
    case "unavailable":
      return "Google did not answer in time. Try again in a few minutes.";
    default:
      return `Google rejected the request (${error.code ?? error.status ?? "unknown"}).`;
  }
}

function kindForStatus(status: number): GoogleErrorKind {
  if (status === 401) return "auth_expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "throttled";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

export async function googleErrorFromResponse(response: Response): Promise<GoogleSheetsError> {
  let code: string | null = null;
  let message = `Google returned HTTP ${response.status}.`;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as {
      error?: { status?: unknown; message?: unknown; details?: Array<{ reason?: unknown }> } | string;
      error_description?: unknown;
    };
    if (body && typeof body.error === "object" && body.error) {
      code = typeof body.error.status === "string" ? body.error.status : null;
      if (typeof body.error.message === "string" && body.error.message) message = body.error.message.slice(0, 300);
      const detail = body.error.details?.find((d) => typeof d.reason === "string");
      reason = typeof detail?.reason === "string" ? detail.reason : null;
    } else if (typeof body?.error === "string") {
      // Token endpoint shape: { error, error_description }.
      code = body.error;
      if (typeof body.error_description === "string") message = body.error_description.slice(0, 300);
    }
  } catch {
    // Non-JSON body: keep the status message.
  }
  let kind = kindForStatus(response.status);
  if (code === "invalid_grant" || code === "unauthorized_client") kind = "auth_expired";
  if (reason === "SERVICE_DISABLED" || /has not been used in project|is disabled/i.test(message)) kind = "api_disabled";
  if (reason === "RATE_LIMIT_EXCEEDED" || code === "RESOURCE_EXHAUSTED") kind = "throttled";
  return new GoogleSheetsError(kind, message, response.status, code, parseRetryAfter(response.headers.get("retry-after")));
}

// ------------------------------------------------------------------ retry

export type GoogleRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetryAfterMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  fetchImpl?: typeof fetch;
};

/**
 * Server errors only. A 429 is never retried here: Google plans to bill requests over the
 * Sheets quota, and every retry after a 429 would be one. The mirror rests that copy
 * instead (throttled_until) and the Excel copy carries the load until the next sync.
 */
const RETRYABLE = new Set([500, 502, 503, 504]);

/**
 * fetch with a timeout and truncated exponential backoff for server errors (Google's
 * documented retry shape). A network failure or timeout is not retried: a write that timed
 * out may have landed.
 */
export async function googleFetch(url: string, init: RequestInit, options: GoogleRetryOptions = {}): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 16_000;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
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
      throw new GoogleSheetsError(
        "unavailable",
        timedOut ? `Google did not answer within ${Math.round(timeoutMs / 1000)}s.` : "Could not reach Google.",
        null,
        timedOut ? "timeout" : "network",
      );
    } finally {
      clearTimeout(timer);
    }
    if (!RETRYABLE.has(response.status) || attempt >= maxAttempts) return response;
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    if (retryAfter !== null && retryAfter > maxRetryAfterMs) return response;
    await response.arrayBuffer().catch(() => undefined);
    await sleep(retryAfter ?? backoffDelayMs(attempt, baseDelayMs, maxDelayMs, random));
  }
}

// ------------------------------------------------------------------ tokens

export type GoogleTokens = { accessToken: string; refreshToken: string | null; expiresIn: number | null };

async function tokenRequest(body: URLSearchParams, retry?: GoogleRetryOptions): Promise<GoogleTokens> {
  const response = await googleFetch(
    GOOGLE_TOKEN_URL,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() },
    retry,
  );
  if (!response.ok) throw await googleErrorFromResponse(response);
  const data = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new GoogleSheetsError("bad_request", "Google did not return an access token.", response.status, "no_access_token");
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
  };
}

export function exchangeGoogleCode(
  config: GoogleSheetsConfig,
  code: string,
  codeVerifier: string,
  retry?: GoogleRetryOptions,
): Promise<GoogleTokens> {
  return tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    retry,
  );
}

export function refreshGoogleTokens(
  config: GoogleSheetsConfig,
  refreshToken: string,
  retry?: GoogleRetryOptions,
): Promise<GoogleTokens> {
  return tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    retry,
  );
}

// ------------------------------------------------------------------ client

export class GoogleSheetsClient {
  constructor(
    private readonly accessToken: string,
    private readonly retry: GoogleRetryOptions = {},
  ) {}

  /** JSON request against any Google API URL; throws GoogleSheetsError on a non-2xx. */
  async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await googleFetch(
      url,
      {
        method,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      this.retry,
    );
    if (!response.ok) throw await googleErrorFromResponse(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export type GoogleAccount = { name: string | null; email: string | null };

export async function readGoogleAccount(client: GoogleSheetsClient): Promise<GoogleAccount> {
  const info = await client.request<{ name?: unknown; email?: unknown }>("GET", GOOGLE_USERINFO_URL);
  return {
    name: typeof info?.name === "string" ? info.name : null,
    email: typeof info?.email === "string" ? info.email : null,
  };
}
