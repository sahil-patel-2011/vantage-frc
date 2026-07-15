/**
 * Canonical public origin for the site (SEO canonicals, OG, robots, sitemap, llms.txt,
 * structured data). Set NEXT_PUBLIC_SITE_URL in the environment to switch domains
 * (e.g. https://vantagefrc.com once the custom domain is live on Vercel); until then
 * it falls back to the current Vercel origin so nothing breaks.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://vantage-frc-web.vercel.app").replace(/\/+$/, "");

/** Host without scheme — handy for display and og image captions. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
