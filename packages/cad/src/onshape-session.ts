/**
 * Onshape auth resolution: saved browser session -> OAuth -> API key.
 *
 * Only the last two are charged to Onshape's annual allowance
 * (https://onshape-public.github.io/docs/auth/limits/, verified 2026-08-24), so the
 * order is not a preference — it is the whole point of the architecture. Every
 * resolved client says which path it is and whether that path spends the cap, and
 * every call it serves is written to the shared call ledger (call-budget.ts).
 *
 * Endpoint shape follows Onshape's published REST contract: base
 * `https://cad.onshape.com/api` for standard accounts, `https://<company>.onshape.com/api`
 * for enterprise, with the version string inserted directly after `/api/`
 * (https://onshape-public.github.io/docs/api-intro/, verified 2026-08-24). `/users/current`
 * is documented there as the endpoint that returns the current user's `id`, which is
 * what this module uses to prove a session is live.
 *
 * Session expiry never surfaces as a raw 401 body. Onshape can reject a stale cookie
 * either with a 401 or by redirecting the request to a sign-in page, so both are
 * classified and both raise OnshapeSessionExpiredError with the one instruction that
 * fixes it.
 */

import {
  createCallBudget,
  type CallBudget,
  type OnshapeAuthPath,
} from "./call-budget";
import { createOnshapeApiKeyHttp, readOnshapeApiKeys } from "./onshape-api-keys";
import {
  cookieHeaderFor,
  isOnshapeSessionExpired,
  loadOnshapeBrowserSession,
  ONSHAPE_DEFAULT_BASE_URL,
  onshapeSessionExpiresAt,
  type OnshapeBrowserSession,
} from "./onshape-session-store";

export type OnshapeHttpFn = (path: string, init?: RequestInit) => Promise<Response>;

export const ONSHAPE_API_VERSION = "v6";

/** The single instruction that resolves an expired session — reused verbatim everywhere. */
export const ONSHAPE_RELOGIN_HINT = "Run `vantage-cad login` to sign into Onshape again in a browser window.";

export class OnshapeSessionExpiredError extends Error {
  readonly code = "onshape_session_expired";
  readonly setupRequired = true;
  readonly remedy = ONSHAPE_RELOGIN_HINT;
  /** The status Onshape actually answered with, so the call ledger records it truthfully. */
  readonly httpStatus?: number;
  constructor(detail?: string, httpStatus?: number) {
    super(
      `Your saved Onshape browser session is no longer valid${detail ? ` (${detail})` : ""}. ${ONSHAPE_RELOGIN_HINT}`,
    );
    this.name = "OnshapeSessionExpiredError";
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

export class OnshapeAuthUnavailableError extends Error {
  readonly code = "onshape_auth_required";
  readonly setupRequired = true;
  constructor(message: string) {
    super(message);
    this.name = "OnshapeAuthUnavailableError";
  }
}

export const ONSHAPE_AUTH_SETUP_MESSAGE = [
  "Onshape is not connected in this terminal. Pick one:",
  "  1. `vantage-cad login` — sign in with a browser window (recommended: these calls are not deducted from your Onshape annual API allowance).",
  "  2. OAuth — connect Onshape in Vantage CAD Connections (hosted runs supply the token).",
  "  3. API keys — set ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY from https://dev-portal.onshape.com/keys. Last resort: every call is deducted from the annual allowance.",
].join("\n");

/** `/api/...` passes through untouched; anything else is versioned, matching the API-key client. */
export function onshapeApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return suffix.startsWith("/api/") ? `${base}${suffix}` : `${base}/api/${ONSHAPE_API_VERSION}${suffix}`;
}

const SIGN_IN_URL = /(^|\.)onshape\.com\/(sign-?in|signin|oauth\/sign-?in)|oauth\.onshape\.com/i;

export type OnshapeResponseClass = "ok" | "expired" | "forbidden" | "error";

/**
 * Decide whether a response means "your session died" as opposed to "you may not
 * touch that document". A stale cookie shows up as 401, or as a followed redirect
 * that landed on a sign-in page (which arrives as a 200 of type text/html).
 */
export function classifyOnshapeResponse(response: {
  status: number;
  ok: boolean;
  url?: string;
  redirected?: boolean;
  headers?: { get(name: string): string | null };
}): OnshapeResponseClass {
  const contentType = response.headers?.get("content-type") ?? "";
  const landedOnSignIn = Boolean(response.url && SIGN_IN_URL.test(response.url));
  if (response.status === 401) return "expired";
  if (landedOnSignIn && (response.redirected || response.status < 400)) return "expired";
  if (response.ok && /text\/html/i.test(contentType) && landedOnSignIn) return "expired";
  if (response.status === 403) return landedOnSignIn ? "expired" : "forbidden";
  if (response.ok) return "ok";
  return "error";
}

export type OnshapeSessionHttpOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/**
 * Replay the saved browser cookies against the REST API. Node's fetch has no cookie
 * jar, so the header is built per-request from the stored cookies using RFC 6265
 * domain/path matching rather than blindly concatenating everything.
 */
export function createOnshapeSessionHttp(
  session: OnshapeBrowserSession,
  options: OnshapeSessionHttpOptions = {},
): OnshapeHttpFn {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  return async (path, init = {}) => {
    const url = onshapeApiUrl(session.baseUrl, path);
    const cookie = cookieHeaderFor(url, session, now());
    if (!cookie) {
      throw new OnshapeSessionExpiredError("no unexpired cookies for this Onshape host");
    }
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json;charset=UTF-8; qs=0.09",
        cookie,
        ...(session.headers ?? {}),
        ...(init.body ? { "content-type": "application/json;charset=UTF-8; qs=0.09" } : {}),
        ...init.headers,
      },
    });
    if (classifyOnshapeResponse(response) === "expired") {
      throw new OnshapeSessionExpiredError(
        `Onshape rejected the saved session with HTTP ${response.status}`,
        response.status,
      );
    }
    return response;
  };
}

export function createOnshapeBearerHttp(
  accessToken: string,
  baseUrl: string = ONSHAPE_DEFAULT_BASE_URL,
  options: OnshapeSessionHttpOptions = {},
): OnshapeHttpFn {
  const fetchImpl = options.fetchImpl ?? fetch;
  return (path, init = {}) =>
    fetchImpl(onshapeApiUrl(baseUrl, path), {
      ...init,
      headers: {
        accept: "application/json;charset=UTF-8; qs=0.09",
        authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "content-type": "application/json;charset=UTF-8; qs=0.09" } : {}),
        ...init.headers,
      },
    });
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type OnshapeAuthResolution = {
  authPath: OnshapeAuthPath;
  /** True when Onshape deducts every call on this path from the annual allowance. */
  countsAgainstAnnualCap: boolean;
  baseUrl: string;
  http: OnshapeHttpFn;
  /** One line naming the path, safe to print. */
  label: string;
  /** Present when the chosen path is not the cheap one, or when a saved session went stale. */
  warning?: string;
  budget: CallBudget;
};

export type ResolveOnshapeAuthOptions = {
  env?: NodeJS.ProcessEnv;
  budget?: CallBudget;
  fetchImpl?: typeof fetch;
  now?: () => number;
  loadSession?: (env: NodeJS.ProcessEnv) => Promise<OnshapeBrowserSession | null>;
  /** Hosted runtimes hand in an org OAuth access token; terminal runs leave this unset. */
  oauthToken?: string | null | (() => Promise<string | null>);
  /** Force one path — diagnostics and tests only. */
  prefer?: OnshapeAuthPath;
};

async function resolveOAuthToken(input: ResolveOnshapeAuthOptions["oauthToken"]): Promise<string | null> {
  if (!input) return null;
  const token = typeof input === "function" ? await input() : input;
  return token && token.trim() ? token.trim() : null;
}

/**
 * Order is fixed: saved browser session, then OAuth, then API keys.
 *
 * A saved-but-expired session does not silently fall through to a paid path — if
 * nothing else is configured it raises OnshapeSessionExpiredError, and if something
 * else IS configured the caller gets that path plus a warning naming the cost, so a
 * lapsed login can never quietly start spending the annual cap.
 */
export async function resolveOnshapeAuth(options: ResolveOnshapeAuthOptions = {}): Promise<OnshapeAuthResolution> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const budget = options.budget ?? createCallBudget({ now });
  const httpOptions: OnshapeSessionHttpOptions = { now, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) };
  const loadSession = options.loadSession ?? loadOnshapeBrowserSession;

  const wantsSession = !options.prefer || options.prefer === "session";
  const session = wantsSession ? await loadSession(env).catch(() => null) : null;
  const sessionExpired = session ? isOnshapeSessionExpired(session, now()) : false;

  if (session && !sessionExpired) {
    const expiresAt = onshapeSessionExpiresAt(session);
    return {
      authPath: "session",
      countsAgainstAnnualCap: false,
      baseUrl: session.baseUrl,
      http: budget.attribute(createOnshapeSessionHttp(session, httpOptions), "session"),
      label: expiresAt
        ? `Onshape browser session (${session.baseUrl}, valid until ${new Date(expiresAt).toISOString()})`
        : `Onshape browser session (${session.baseUrl})`,
      budget,
    };
  }

  const staleNote = sessionExpired
    ? `The saved Onshape browser session has expired, so this run fell back to a path that IS deducted from your annual API allowance. ${ONSHAPE_RELOGIN_HINT}`
    : undefined;

  const oauthToken = !options.prefer || options.prefer === "oauth" ? await resolveOAuthToken(options.oauthToken) : null;
  if (oauthToken) {
    const baseUrl = (env.ONSHAPE_BASE_URL ?? ONSHAPE_DEFAULT_BASE_URL).replace(/\/$/, "");
    return {
      authPath: "oauth",
      countsAgainstAnnualCap: true,
      baseUrl,
      http: budget.attribute(createOnshapeBearerHttp(oauthToken, baseUrl, httpOptions), "oauth"),
      label: `Onshape OAuth token (${baseUrl})`,
      warning:
        staleNote ??
        "OAuth calls from a non-App-Store application are deducted from the Onshape annual allowance. `vantage-cad login` avoids that.",
      budget,
    };
  }

  const keys = !options.prefer || options.prefer === "api-key" ? readOnshapeApiKeys(env) : null;
  if (keys) {
    const keyHttp = createOnshapeApiKeyHttp(keys);
    return {
      authPath: "api-key",
      countsAgainstAnnualCap: true,
      baseUrl: keys.baseUrl,
      http: budget.attribute(
        options.fetchImpl
          ? // The API-key client closes over global fetch; re-point it when a test injects one.
            ((path, init) => options.fetchImpl!(onshapeApiUrl(keys.baseUrl, path), withKeyHeaders(keys, init)))
          : keyHttp,
        "api-key",
      ),
      label: `Onshape API key (${keys.baseUrl})`,
      warning:
        staleNote ??
        "API-key calls are deducted from your Onshape annual allowance (2,500–10,000 per year depending on plan). Prefer `vantage-cad login`.",
      budget,
    };
  }

  if (sessionExpired) throw new OnshapeSessionExpiredError("stored cookies have lapsed");
  throw new OnshapeAuthUnavailableError(ONSHAPE_AUTH_SETUP_MESSAGE);
}

function withKeyHeaders(
  keys: { accessKey: string; secretKey: string },
  init: RequestInit = {},
): RequestInit {
  const basic = Buffer.from(`${keys.accessKey}:${keys.secretKey}`, "utf8").toString("base64");
  return {
    ...init,
    headers: {
      accept: "application/json;charset=UTF-8; qs=0.09",
      authorization: `Basic ${basic}`,
      ...(init.body ? { "content-type": "application/json;charset=UTF-8; qs=0.09" } : {}),
      ...init.headers,
    },
  };
}

// ---------------------------------------------------------------------------
// Status + probe
// ---------------------------------------------------------------------------

export type OnshapeAuthStatus = {
  connected: boolean;
  setupRequired: boolean;
  authPath: OnshapeAuthPath | null;
  countsAgainstAnnualCap: boolean;
  baseUrl: string | null;
  message: string;
  warning?: string;
};

/** Non-throwing form for status surfaces: reports setup_required instead of raising. */
export async function onshapeAuthStatus(options: ResolveOnshapeAuthOptions = {}): Promise<OnshapeAuthStatus> {
  try {
    const resolved = await resolveOnshapeAuth(options);
    return {
      connected: true,
      setupRequired: false,
      authPath: resolved.authPath,
      countsAgainstAnnualCap: resolved.countsAgainstAnnualCap,
      baseUrl: resolved.baseUrl,
      message: resolved.label,
      ...(resolved.warning ? { warning: resolved.warning } : {}),
    };
  } catch (error) {
    return {
      connected: false,
      setupRequired: true,
      authPath: null,
      countsAgainstAnnualCap: false,
      baseUrl: null,
      message: error instanceof Error ? error.message : ONSHAPE_AUTH_SETUP_MESSAGE,
    };
  }
}

export type OnshapeIdentity = {
  id: string;
  name?: string;
  email?: string;
};

/**
 * One call to the documented `/users/current` endpoint — the cheapest honest proof
 * that an auth path actually works. Costs 1 call on whichever path is passed in.
 */
export async function probeOnshapeIdentity(http: OnshapeHttpFn): Promise<OnshapeIdentity | null> {
  const response = await http("/users/current");
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const id = body && typeof body === "object" ? String(body.id ?? "") : "";
  if (!id) return null;
  return {
    id,
    ...(body?.name ? { name: String(body.name) } : {}),
    ...(body?.email ? { email: String(body.email) } : {}),
  };
}
