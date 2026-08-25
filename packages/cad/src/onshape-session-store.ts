/**
 * On-disk store for the Onshape browser session captured by `vantage-cad login`
 * (the `cadcursor login` step): the user signs into their own Onshape account in a
 * real Chromium window, and the resulting cookies are saved to a 0600 file under
 * the user's home directory.
 *
 * Why this path exists at all: Onshape's annual API-call allowance is charged to
 * API keys and to OAuth from non-App-Store applications, while calls made by
 * "Onshape browser and mobile clients" and by the "API Explorer when using Onshape
 * session authentication" are explicitly NOT counted.
 * https://onshape-public.github.io/docs/auth/limits/ (verified 2026-08-24)
 *
 * What is NOT verified, and is treated as the owner's operating assumption rather
 * than documented behaviour: Onshape does not publish a supported contract for a
 * third-party process replaying browser session cookies against /api/. The cookie
 * NAMES are likewise unpublished, so nothing here hardcodes one — every onshape.com
 * cookie the browser holds is stored, and expiry is derived heuristically with the
 * authoritative signal being a 401 / sign-in redirect at request time
 * (see onshape-session.ts).
 *
 * Nothing in this module logs or returns a cookie value.
 */

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const ONSHAPE_SESSION_STORE_VERSION = 1;
export const ONSHAPE_SESSION_FILE = "onshape-session.json";
export const ONSHAPE_DEFAULT_BASE_URL = "https://cad.onshape.com";

/** Cookie shape as Playwright reports it: `expires` is SECONDS since epoch, -1 = session cookie. */
export type OnshapeSessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type OnshapeBrowserSession = {
  version: number;
  /** Origin the session was captured on — enterprise accounts are <company>.onshape.com. */
  baseUrl: string;
  cookies: OnshapeSessionCookie[];
  /**
   * Non-cookie request headers observed on a real Onshape web-client /api/ call
   * (CSRF-style tokens). Onshape does not document these; the capture is empty
   * when the live client sent none, and replay simply omits them.
   */
  headers?: Record<string, string>;
  capturedAt: string;
  /** Account label observed from /users/current at capture time, for status output only. */
  accountLabel?: string;
};

/** `VANTAGE_CAD_HOME` exists so tests (and portable installs) never touch the real home dir. */
export function vantageCadHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.VANTAGE_CAD_HOME ?? "").trim();
  return override || join(homedir(), ".vantage-cad");
}

export function onshapeSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(vantageCadHome(env), ONSHAPE_SESSION_FILE);
}

/** Headers worth replaying: CSRF-style tokens only. Never cookie, never authorization. */
export function isReplayableSessionHeader(name: string): boolean {
  const key = name.toLowerCase();
  if (key === "cookie" || key === "authorization") return false;
  return /^x-[a-z0-9-]*(xsrf|csrf)[a-z0-9-]*$/.test(key);
}

export function pickReplayableHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!value) continue;
    if (isReplayableSessionHeader(name)) out[name.toLowerCase()] = value;
  }
  return out;
}

function isOnshapeHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\./, "");
  return lower === "onshape.com" || lower.endsWith(".onshape.com");
}

/** Coerce whatever the browser driver handed us into the stored shape, dropping non-Onshape cookies. */
export function normalizeOnshapeCookies(raw: readonly unknown[]): OnshapeSessionCookie[] {
  const out: OnshapeSessionCookie[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const cookie = item as Record<string, unknown>;
    const name = String(cookie.name ?? "").trim();
    const domain = String(cookie.domain ?? "").trim();
    if (!name || !domain || !isOnshapeHost(domain)) continue;
    const expiresRaw = Number(cookie.expires);
    out.push({
      name,
      value: String(cookie.value ?? ""),
      domain,
      path: String(cookie.path ?? "/") || "/",
      expires: Number.isFinite(expiresRaw) ? expiresRaw : -1,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      ...(cookie.sameSite === "Strict" || cookie.sameSite === "Lax" || cookie.sameSite === "None"
        ? { sameSite: cookie.sameSite }
        : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cookie matching (RFC 6265 §5.1.3 domain-match, §5.1.4 path-match)
// ---------------------------------------------------------------------------

export function cookieDomainMatches(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.toLowerCase().replace(/^\./, "");
  const target = host.toLowerCase();
  if (!domain) return false;
  return target === domain || target.endsWith(`.${domain}`);
}

export function cookiePathMatches(cookiePath: string, requestPath: string): boolean {
  const cookie = cookiePath || "/";
  const request = requestPath || "/";
  if (cookie === "/") return true;
  if (request === cookie) return true;
  if (request.startsWith(cookie)) {
    return cookie.endsWith("/") || request.charAt(cookie.length) === "/";
  }
  return false;
}

export function isCookieExpired(cookie: OnshapeSessionCookie, nowMs: number): boolean {
  // -1 (or any non-positive value) is a browser session cookie: no stored expiry,
  // so only the server can tell us it is dead.
  if (!Number.isFinite(cookie.expires) || cookie.expires <= 0) return false;
  return cookie.expires * 1000 <= nowMs;
}

/** Build the `cookie` request header for one URL. Returns "" when nothing matches. */
export function cookieHeaderFor(
  url: string | URL,
  session: OnshapeBrowserSession,
  nowMs: number = Date.now(),
): string {
  const target = typeof url === "string" ? new URL(url) : url;
  const secureRequest = target.protocol === "https:";
  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const cookie of session.cookies) {
    if (cookie.secure && !secureRequest) continue;
    if (!cookieDomainMatches(cookie.domain, target.hostname)) continue;
    if (!cookiePathMatches(cookie.path, target.pathname)) continue;
    if (isCookieExpired(cookie, nowMs)) continue;
    if (seen.has(cookie.name)) continue;
    seen.add(cookie.name);
    pairs.push(`${cookie.name}=${cookie.value}`);
  }
  return pairs.join("; ");
}

/**
 * Earliest expiry among the persistent httpOnly cookies, in ms since epoch.
 *
 * Heuristic, and labelled as such: Onshape publishes neither the names nor the
 * lifetimes of its session cookies, so this is only good enough to say "this
 * saved session is definitely stale" before spending a request. `null` means
 * "unknown" — every cookie is a browser-session cookie — and the only reliable
 * expiry signal is then the 401 / sign-in redirect handled in onshape-session.ts.
 */
export function onshapeSessionExpiresAt(session: OnshapeBrowserSession): number | null {
  let earliest: number | null = null;
  for (const cookie of session.cookies) {
    if (!cookie.httpOnly) continue;
    if (!Number.isFinite(cookie.expires) || cookie.expires <= 0) continue;
    const ms = cookie.expires * 1000;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest;
}

/** True only when every stored cookie that could carry auth has already lapsed. */
export function isOnshapeSessionExpired(session: OnshapeBrowserSession, nowMs: number = Date.now()): boolean {
  const live = session.cookies.filter((cookie) => !isCookieExpired(cookie, nowMs));
  if (live.length === 0) return true;
  const expiresAt = onshapeSessionExpiresAt(session);
  return expiresAt !== null && expiresAt <= nowMs;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function parseOnshapeBrowserSession(raw: unknown): OnshapeBrowserSession | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const cookies = Array.isArray(record.cookies) ? normalizeOnshapeCookies(record.cookies) : [];
  if (cookies.length === 0) return null;
  const baseUrl = String(record.baseUrl ?? ONSHAPE_DEFAULT_BASE_URL).replace(/\/$/, "");
  return {
    version: Number(record.version ?? ONSHAPE_SESSION_STORE_VERSION),
    baseUrl: baseUrl || ONSHAPE_DEFAULT_BASE_URL,
    cookies,
    headers: pickReplayableHeaders(record.headers as Record<string, string> | undefined),
    capturedAt: String(record.capturedAt ?? new Date(0).toISOString()),
    ...(record.accountLabel ? { accountLabel: String(record.accountLabel) } : {}),
  };
}

export async function loadOnshapeBrowserSession(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OnshapeBrowserSession | null> {
  try {
    const raw = await readFile(onshapeSessionPath(env), "utf8");
    return parseOnshapeBrowserSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveOnshapeBrowserSession(
  session: OnshapeBrowserSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (session.cookies.length === 0) {
    throw new Error("Refusing to save an Onshape session with no cookies — sign-in did not complete.");
  }
  const dir = vantageCadHome(env);
  await mkdir(dir, { recursive: true });
  const path = onshapeSessionPath(env);
  const payload: OnshapeBrowserSession = {
    ...session,
    version: ONSHAPE_SESSION_STORE_VERSION,
    baseUrl: session.baseUrl.replace(/\/$/, ""),
    headers: pickReplayableHeaders(session.headers),
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  // mode on writeFile is ignored when the file already exists; chmod is the guarantee.
  await chmod(path, 0o600);
  return path;
}

export async function clearOnshapeBrowserSession(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const path = onshapeSessionPath(env);
  try {
    await rm(path, { force: false });
    return true;
  } catch {
    return false;
  }
}

export type OnshapeSessionStatus = {
  connected: boolean;
  setupRequired: boolean;
  message: string;
  baseUrl: string | null;
  capturedAt: string | null;
  /** null when every stored cookie is a browser-session cookie with no published lifetime. */
  expiresAt: string | null;
  accountLabel: string | null;
  cookieCount: number;
};

export function onshapeSessionStatus(
  session: OnshapeBrowserSession | null,
  nowMs: number = Date.now(),
): OnshapeSessionStatus {
  if (!session) {
    return {
      connected: false,
      setupRequired: true,
      message:
        "No saved Onshape browser session. Run `vantage-cad login` to sign in once — session calls do not consume your Onshape annual API-key allowance.",
      baseUrl: null,
      capturedAt: null,
      expiresAt: null,
      accountLabel: null,
      cookieCount: 0,
    };
  }
  const expiresAt = onshapeSessionExpiresAt(session);
  if (isOnshapeSessionExpired(session, nowMs)) {
    return {
      connected: false,
      setupRequired: true,
      message: "Your saved Onshape browser session has expired. Run `vantage-cad login` to sign in again.",
      baseUrl: session.baseUrl,
      capturedAt: session.capturedAt,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      accountLabel: session.accountLabel ?? null,
      cookieCount: session.cookies.length,
    };
  }
  return {
    connected: true,
    setupRequired: false,
    message: expiresAt
      ? `Onshape browser session is saved and valid until ${new Date(expiresAt).toISOString()}.`
      : "Onshape browser session is saved. Onshape does not publish a cookie lifetime, so expiry is detected on the first rejected call.",
    baseUrl: session.baseUrl,
    capturedAt: session.capturedAt,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    accountLabel: session.accountLabel ?? null,
    cookieCount: session.cookies.length,
  };
}
