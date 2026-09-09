/** Production web app the desktop shell loads by default. */
export const DEFAULT_PRODUCTION_ORIGIN = "https://vantage-frc-web.vercel.app";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function endsWithHost(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function pathEndsWith(url: URL, fileName: string): boolean {
  const path = decodeURIComponent(url.pathname).replace(/\\/g, "/").toLowerCase();
  return path === `/${fileName}` || path.endsWith(`/${fileName}`);
}

/** Local shell pages (offline / sign-in gate / update) bundled next to dist/. */
const LOCAL_SHELL_PAGES = ["offline.html", "gate.html", "update.html"] as const;

export function isLocalShellPage(url: URL): boolean {
  return LOCAL_SHELL_PAGES.some((page) => pathEndsWith(url, page));
}

/** Origins the BrowserWindow is allowed to *start* on. */
export function isAllowedAppOrigin(url: URL): boolean {
  const host = hostnameOf(url);
  if (LOOPBACK.has(host)) {
    return url.protocol === "http:" || url.protocol === "https:";
  }
  return url.protocol === "https:" && host === "vantage-frc-web.vercel.app";
}

/**
 * Navigation during a session: production Vantage, local dev, and the OAuth/checkout
 * hosts the product actually uses. Arbitrary https is denied.
 */
export function isAllowedNavigation(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }

  if (url.protocol === "about:") {
    return url.pathname === "blank" || hostnameOf(url) === "blank";
  }
  if (url.protocol === "file:") {
    return isLocalShellPage(url);
  }

  const host = hostnameOf(url);
  if (LOOPBACK.has(host)) {
    return url.protocol === "http:" || url.protocol === "https:";
  }
  if (url.protocol !== "https:") return false;

  if (host === "vantage-frc-web.vercel.app") return true;
  if (endsWithHost(host, "google.com")) return true;
  if (endsWithHost(host, "gstatic.com")) return true;
  if (endsWithHost(host, "googleusercontent.com")) return true;
  if (endsWithHost(host, "googleapis.com")) return true;
  if (endsWithHost(host, "stripe.com")) return true;
  if (endsWithHost(host, "onshape.com")) return true;
  if (endsWithHost(host, "github.com")) return true;
  return false;
}

export function shouldOpenExternally(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
}

/** Drop empty/invalid VANTAGE_URL instead of loading an attacker origin. */
export function sanitizeAppOrigin(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_PRODUCTION_ORIGIN;
  try {
    const url = new URL(trimmed);
    if (!isAllowedAppOrigin(url)) return DEFAULT_PRODUCTION_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_PRODUCTION_ORIGIN;
  }
}

export function stripElectronUserAgent(userAgent: string): string {
  return userAgent.replace(/\sElectron\/[\d.]+/gi, "").replace(/\s+/g, " ").trim();
}

/**
 * Better Auth session cookie in the persisted partition. Presence gates the shell;
 * the server (proxy.ts) stays the authority on validity/expiry.
 */
export function isSessionCookieName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "better-auth.session_token" ||
    normalized === "__secure-better-auth.session_token"
  );
}

/** RFC 6265 domain-match so we only count session cookies set by the app origin. */
export function cookieMatchesHost(cookieDomain: string | undefined, host: string): boolean {
  if (!cookieDomain) return false;
  const domain = cookieDomain.replace(/^\./, "").toLowerCase();
  const target = host.toLowerCase();
  if (!domain) return false;
  return target === domain || target.endsWith(`.${domain}`);
}

/**
 * Pages a signed-out user may reach on the app origin: the sign-in flow plus the
 * public marketing/legal pages mirrored from apps/web proxy.ts PUBLIC_PAGES.
 */
const SIGNED_OUT_PAGES = new Set([
  "/",
  "/desktop",
  "/features",
  "/features/cad",
  "/features/strategy",
  "/features/code",
  "/workflow",
  "/for-teams",
  "/pricing",
  "/privacy",
  "/terms",
  "/signin",
  "/sign-in",
  "/invite",
  "/offline",
  "/unsubscribe",
]);

/**
 * Account gate: with no session cookie the shell only permits the sign-in flow
 * (app-origin public pages, /api/auth/*, Google OAuth hosts) and local shell pages.
 */
export function isAllowedWhileSignedOut(href: string, appOrigin: string): boolean {
  if (!isAllowedNavigation(href)) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  // about:blank and the bundled gate/offline pages already passed the strict checks above.
  if (url.protocol === "about:" || url.protocol === "file:") return true;

  const host = hostnameOf(url);
  // Google hosts are the OAuth leg of sign-in.
  if (
    endsWithHost(host, "google.com") ||
    endsWithHost(host, "gstatic.com") ||
    endsWithHost(host, "googleusercontent.com") ||
    endsWithHost(host, "googleapis.com")
  ) {
    return true;
  }

  let origin: URL;
  try {
    origin = new URL(appOrigin);
  } catch {
    return false;
  }
  if (url.origin !== origin.origin) return false;

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (SIGNED_OUT_PAGES.has(path)) return true;
  if (path.startsWith("/api/auth/")) return true; // OAuth callbacks navigate here.
  if (path.startsWith("/invite/")) return true; // Invite acceptance links.
  return false;
}

/**
 * vantage-frc:// deep links → app path. Accepts `vantage-frc://open/<path>` or
 * `vantage-frc:///<path>`; returns a safe absolute path or null.
 */
export function parseDeepLinkPath(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "vantage-frc:") return null;
  const host = url.hostname.toLowerCase();
  if (host && host !== "open") return null;
  let path = url.pathname || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.includes("..") || path.includes("\\")) return null;
  if (!/^\/[A-Za-z0-9\-_/.]*$/.test(path)) return null;
  // Search string comes from the parsed URL, so it is already percent-encoded.
  const search = /^(\?[A-Za-z0-9\-_.~%=&+]*)?$/.test(url.search) ? url.search : "";
  return `${path}${search}`;
}
