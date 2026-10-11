import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The outage console link in the owner's alert email.
 *
 * Signing in needs the database, so during an outage nobody — not even the platform admin —
 * can. The console instead trusts this token: base64url(payload) "." base64url(HMAC-SHA256),
 * keyed with BETTER_AUTH_SECRET, payload `{ incidentId, exp, purpose: "outage-console" }`,
 * valid 24 hours and only for the incident it names. Each alert email carries a fresh one.
 */

export const CONSOLE_TOKEN_PURPOSE = "outage-console";
/**
 * The console link is swapped for this HttpOnly cookie by /status/outage/open before any page
 * renders, so the key never sits in the address bar, browser history or an analytics pageview.
 */
export const CONSOLE_COOKIE = "vantage_outage_console";
export const CONSOLE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type ConsoleTokenFailure = "malformed" | "signature" | "expired" | "purpose" | "secret_missing";
export type ConsoleTokenResult =
  | { ok: true; incidentId: string; expiresAt: number }
  | { ok: false; reason: ConsoleTokenFailure };

type TokenEnv = { BETTER_AUTH_SECRET?: string; NODE_ENV?: string };

function secretFor(env: TokenEnv): string | null {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (secret && secret !== "[SENSITIVE]") return secret;
  return env.NODE_ENV === "production" ? null : "local-outage-console-secret";
}

/** HMAC over the encoded payload, prefixed so no other signed value in the app can pass for one. */
function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(`${CONSOLE_TOKEN_PURPOSE}|${body}`).digest("base64url");
}

export function signConsoleToken(
  incidentId: string,
  env: TokenEnv = process.env,
  now = Date.now(),
  ttlMs = CONSOLE_TOKEN_TTL_MS,
): string | null {
  const secret = secretFor(env);
  if (!secret) return null;
  const payload = { incidentId, exp: Math.floor((now + ttlMs) / 1000), purpose: CONSOLE_TOKEN_PURPOSE };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyConsoleToken(token: unknown, env: TokenEnv = process.env, now = Date.now()): ConsoleTokenResult {
  if (typeof token !== "string" || token.length > 600) return { ok: false, reason: "malformed" };
  const secret = secretFor(env);
  if (!secret) return { ok: false, reason: "secret_missing" };
  const parts = token.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts as [string, string];
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "signature" };
  let payload: { incidentId?: unknown; exp?: unknown; purpose?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.purpose !== CONSOLE_TOKEN_PURPOSE) return { ok: false, reason: "purpose" };
  if (typeof payload.incidentId !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(payload.incidentId)) {
    return { ok: false, reason: "malformed" };
  }
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  if (exp * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, incidentId: payload.incidentId, expiresAt: exp * 1000 };
}

/** The console cookie's value from a Cookie header, or null. */
export function consoleTokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CONSOLE_COOKIE) {
      try {
        return decodeURIComponent(rest.join("=")) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Token from `Authorization: Bearer …`, `x-outage-token`, a JSON body's `token`, or the console cookie. */
export function consoleTokenFromRequest(request: Request, body?: { token?: unknown } | null): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || null;
  const direct = request.headers.get("x-outage-token");
  if (direct) return direct.trim() || null;
  if (typeof body?.token === "string") return body.token;
  return consoleTokenFromCookieHeader(request.headers.get("cookie"));
}
