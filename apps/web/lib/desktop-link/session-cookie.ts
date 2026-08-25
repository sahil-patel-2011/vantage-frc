/**
 * Extract the Better Auth session cookie from the Set-Cookie headers returned
 * by `auth.api.createDesktopLinkSession({ returnHeaders: true })` so the
 * desktop shell can install exactly what a browser would have stored.
 *
 * The value is kept RAW (still percent-encoded, signature included) — the
 * desktop writes it verbatim into its cookie jar, the same bytes a browser
 * would persist from this header.
 */

export type DesktopSessionCookie = {
  name: string;
  /** Raw cookie value exactly as it appears in the Set-Cookie header. */
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none" | null;
  /** ISO timestamp; null for a session cookie with no explicit lifetime. */
  expiresAt: string | null;
};

/** Mirrors apps/desktop/src/allowlist.ts isSessionCookieName. */
export function isSessionCookieName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "better-auth.session_token" ||
    normalized === "__secure-better-auth.session_token"
  );
}

function parseAttributes(segments: string[], now: Date): Omit<DesktopSessionCookie, "name" | "value"> {
  let path = "/";
  let secure = false;
  let httpOnly = false;
  let sameSite: DesktopSessionCookie["sameSite"] = null;
  let expiresAt: string | null = null;
  let maxAgeSeconds: number | null = null;

  for (const segment of segments) {
    const [rawKey, ...rest] = segment.split("=");
    const key = (rawKey ?? "").trim().toLowerCase();
    const value = rest.join("=").trim();
    if (key === "path" && value) path = value;
    else if (key === "secure") secure = true;
    else if (key === "httponly") httpOnly = true;
    else if (key === "samesite") {
      const normalized = value.toLowerCase();
      if (normalized === "lax" || normalized === "strict" || normalized === "none") sameSite = normalized;
    } else if (key === "max-age") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) maxAgeSeconds = parsed;
    } else if (key === "expires" && value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) expiresAt = parsed.toISOString();
    }
  }

  // Max-Age wins over Expires (RFC 6265 §5.3).
  if (maxAgeSeconds !== null) {
    expiresAt = new Date(now.getTime() + maxAgeSeconds * 1000).toISOString();
  }
  return { path, secure, httpOnly, sameSite, expiresAt };
}

/**
 * Find the session-token cookie among the response's Set-Cookie headers.
 * Ignores every other cookie (session_data cache chunks, dont_remember, …).
 */
export function extractSessionCookie(
  setCookieHeaders: readonly string[],
  now: Date = new Date(),
): DesktopSessionCookie | null {
  for (const header of setCookieHeaders) {
    const segments = header.split(";");
    const first = segments.shift();
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!isSessionCookieName(name) || !value) continue;
    return { name, value, ...parseAttributes(segments, now) };
  }
  return null;
}
