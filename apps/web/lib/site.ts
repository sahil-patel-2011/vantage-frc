/**
 * Canonical public origin for the site (SEO canonicals, OG, robots, sitemap, llms.txt,
 * structured data).
 *
 * Priority: NEXT_PUBLIC_SITE_URL → NEXT_PUBLIC_APP_URL → production Vercel host → default.
 * When you attach a custom domain, set NEXT_PUBLIC_SITE_URL (and BETTER_AUTH_URL /
 * NEXT_PUBLIC_APP_URL) to https://your-domain.com so metadataBase / OG / sitemap leave
 * *.vercel.app permanently.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://vantage-frc-web.vercel.app")
).replace(/\/+$/, "");

/** Host without scheme — handy for display and og image captions. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
