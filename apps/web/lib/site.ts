/**
 * Canonical public origin for the site (SEO canonicals, OG, robots, sitemap, llms.txt,
 * structured data).
 *
 * Priority: NEXT_PUBLIC_SITE_URL → NEXT_PUBLIC_APP_URL → production Vercel host → default.
 * When you attach a custom domain, set NEXT_PUBLIC_SITE_URL (and BETTER_AUTH_URL /
 * NEXT_PUBLIC_APP_URL) to https://your-domain.com so metadataBase / OG / sitemap leave
 * *.vercel.app permanently.
 *
 * ## Why this refuses to trust its own environment
 *
 * `vantage-frc-web.vercel.app` is retired — the hostname answers
 * `DEPLOYMENT_NOT_FOUND`. The auth layer learned that and rewrites it
 * (`LIVE_AUTH_ORIGIN` in `@vantage/core`), so signing in kept working. This
 * module did not, and production `NEXT_PUBLIC_APP_URL` still held the dead
 * host — so every page shipped `<link rel="canonical">` and `og:url` pointing
 * at a hostname that does not resolve, with `robots: index, follow`.
 *
 * That fails silently in the worst way: the pages render, nobody sees an
 * error, and meanwhile search engines are told the canonical version of every
 * page is a 404 and every shared link preview resolves to nothing.
 *
 * So a retired host is mapped here too, rather than assumed never to appear.
 * The environment is the thing that was wrong; a module that trusts it
 * completely inherits the mistake.
 */

/** Hosts that used to serve this app and no longer resolve. */
const RETIRED_HOSTS = new Set(["vantage-frc-web.vercel.app"]);

/**
 * The alias people actually open, and the one the auth layer canonicalises to.
 * Kept identical to `LIVE_AUTH_ORIGIN` in `@vantage/core` — a test asserts it,
 * because a site canonical and an auth callback disagreeing about where the
 * product lives is its own class of bug.
 */
export const LIVE_SITE_ORIGIN = "https://vantagefrc.vercel.app";

function liveOrigin(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (RETIRED_HOSTS.has(url.hostname.toLowerCase())) return LIVE_SITE_ORIGIN;
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmed;
  }
}

/**
 * The origin to publish, given an environment.
 *
 * Exported as a pure function so the rules above can be tested without
 * re-importing this module under a mutated `process.env` — a module-cache
 * trick that reads as cleverness and breaks the moment the bundler decides a
 * query string means the file is no longer TypeScript.
 */
export function resolveSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  return liveOrigin(
    env.NEXT_PUBLIC_SITE_URL ??
      env.NEXT_PUBLIC_APP_URL ??
      (env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
        : LIVE_SITE_ORIGIN),
  );
}

export const SITE_URL = resolveSiteUrl();

/** Host without scheme — handy for display and og image captions. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
