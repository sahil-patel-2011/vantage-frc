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
    return pathEndsWith(url, "offline.html");
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
