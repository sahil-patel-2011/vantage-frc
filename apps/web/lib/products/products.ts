/**
 * Two products, one ecosystem.
 *
 * Vantage is the team's operating system — calendar, build, business, chat,
 * AI. Scouting is the focused tool a scouter and a strategist live in at an
 * event — fast entry, team lookup, match prediction, the pick list. They are
 * separate products the way a drive and a document editor are: each has its
 * own front door and its own navigation, and each is one tap from the other.
 *
 * They are NOT separate systems. Both are served by this one Next.js
 * deployment, read and write the same Postgres rows under the same RLS, and
 * know the same person, team and role. The only thing that differs between
 * them is the hostname and which routes that hostname presents.
 *
 * Hostnames come from env so the same build works everywhere:
 *   NEXT_PUBLIC_VANTAGE_ORIGIN   https://vantagefrc.vercel.app
 *   NEXT_PUBLIC_SCOUTING_ORIGIN  https://vantagefrc-scouting.vercel.app
 * With no scouting origin set (local dev, previews) Scouting lives at /scout
 * on the same host and no handoff is needed.
 *
 * `scouting.vantagefrc.vercel.app` is not possible: Vercel does not issue
 * nested subdomains under a project's vercel.app name. On a custom domain
 * (vantagefrc.com + scouting.vantagefrc.com) set the two origins and the same
 * code serves it — see docs/PRODUCTS.md.
 */

export type ProductId = "vantage" | "scouting";

export const DEFAULT_VANTAGE_ORIGIN = "https://vantagefrc.vercel.app";
export const DEFAULT_SCOUTING_ORIGIN = "https://vantagefrc-scouting.vercel.app";

/** Where Scouting's own pages live on any host. */
export const SCOUTING_HOME = "/scout";

/**
 * Paths the Scouting host presents. Everything else on that host belongs to
 * Vantage and is sent there, so Scouting stays a focused product instead of a
 * second copy of everything.
 */
const SCOUTING_PATH_PREFIXES = [
  "/scout",
  "/s/",
  "/f/",
  "/offline",
  "/signin",
  "/sign-in",
  "/invite",
  "/onboarding",
  "/terms",
  "/privacy",
  "/media-paused",
];

/**
 * Vantage paths whose Scouting twin lives under /scout. On the Scouting host an
 * old link (a bookmark, a link inside a shared feature) lands on the twin
 * instead of leaving the product.
 */
const SCOUTING_TWINS: Record<string, string> = {
  "/scouting": "/scout/entry",
  "/intel": "/scout/teams",
  "/match-sim": "/scout/predict",
  "/picklist-collab": "/scout/picklist",
};

export function scoutingTwin(pathname: string): string | null {
  return SCOUTING_TWINS[pathname] ?? null;
}

/** Served on every host: framework, auth, APIs, static files. */
const SHARED_PREFIXES = ["/api/", "/_next/", "/favicon", "/icons/", "/manifest", "/sw", "/robots", "/sitemap"];

function asOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Literal `process.env.NEXT_PUBLIC_…` reads, not `process.env[name]`: Next
// inlines only the literal form into browser bundles, and these helpers run in
// client components ("Back to Vantage") as well as the proxy.
export function vantageOrigin(): string | null {
  return asOrigin(process.env.NEXT_PUBLIC_VANTAGE_ORIGIN);
}

export function scoutingOrigin(): string | null {
  return asOrigin(process.env.NEXT_PUBLIC_SCOUTING_ORIGIN);
}

function hostOf(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Which product a request's host is. Unknown hosts are Vantage. */
export function productForHost(host: string | null | undefined): ProductId {
  const scoutingHost = hostOf(scoutingOrigin());
  if (host && scoutingHost && host.toLowerCase() === scoutingHost) return "scouting";
  return "vantage";
}

/** True when the two products are on different hosts (so a handoff is needed). */
export function productsSplitAcrossHosts(): boolean {
  const scouting = hostOf(scoutingOrigin());
  const vantage = hostOf(vantageOrigin());
  return Boolean(scouting && vantage && scouting !== vantage);
}

export function isSharedPath(pathname: string): boolean {
  return SHARED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || /\.[a-z0-9]{2,5}$/i.test(pathname);
}

export function isScoutingPath(pathname: string): boolean {
  return SCOUTING_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || pathname.startsWith(`${prefix}?`),
  );
}

/**
 * Where a request on `host` for `pathname` should go, or null to serve it.
 *
 *  - Scouting host, "/"                 → /scout (its own home)
 *  - Scouting host, a Vantage-only path → the same path on the Vantage origin
 *  - anything else                      → serve
 *
 * The Vantage host serves every path, /scout included, so a link that never
 * learned about the split still works.
 */
export function productRedirect(input: { host: string | null; pathname: string; search: string }): string | null {
  if (productForHost(input.host) !== "scouting") return null;
  if (isSharedPath(input.pathname)) return null;
  if (input.pathname === "/") return SCOUTING_HOME;
  if (isScoutingPath(input.pathname)) return null;
  const twin = scoutingTwin(input.pathname);
  if (twin) return `${twin}${input.search}`;
  const vantage = vantageOrigin();
  return vantage ? `${vantage}${input.pathname}${input.search}` : null;
}

/**
 * A link from one product to the other. On one host it is just the path; split
 * across hosts it goes through the handoff so the person arrives signed in.
 */
export function crossProductHref(to: ProductId, path: string, orgId?: string | null): string {
  const target = to === "scouting" ? path || SCOUTING_HOME : path || "/dashboard";
  if (!productsSplitAcrossHosts()) {
    return orgId && !target.includes("orgId=") ? `${target}${target.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}` : target;
  }
  const params = new URLSearchParams({ to, path: target });
  if (orgId) params.set("orgId", orgId);
  return `/api/handoff/start?${params.toString()}`;
}

export function originFor(product: ProductId): string | null {
  return product === "scouting" ? scoutingOrigin() : vantageOrigin();
}

/**
 * The origin the browser actually asked for. `request.url` in Next is built
 * from the server's configured host, which on a two-host setup can name the
 * other product — so a redirect built from it lands on the wrong host.
 */
export function requestOrigin(request: { url: string; headers: { get(name: string): string | null } }): string {
  const fallback = new URL(request.url);
  const host = (request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? fallback.host)
    .split(",")[0]!
    .trim();
  const proto = (request.headers.get("x-forwarded-proto") ?? fallback.protocol.replace(/:$/, ""))
    .split(",")[0]!
    .trim();
  return `${proto === "http" ? "http" : "https"}://${host}`;
}
