export const CONNECTOR_VERSION = "0.1.0";

/**
 * Canonical production origin. Must stay byte-identical to CANONICAL_BASE_URL in
 * packages/ai-bridge/bridge.mjs, DEFAULT_PRODUCTION_ORIGIN in apps/desktop/src/allowlist.ts,
 * SITE_URL in apps/web/lib/site.ts, and the origin added in packages/core/src/access-policy.ts.
 * Pairing with no explicit --url/VANTAGE_URL targets this host, so drift here silently points
 * mentors at a deployment that does not exist.
 */
export const CANONICAL_BASE_URL = "https://vantage-frc-web.vercel.app";

/**
 * Default base URL for a fresh pairing. Reads VANTAGE_URL at call time (never at module
 * scope) so importing this package stays side-effect free and tests can pass their own env.
 */
export function defaultBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.VANTAGE_URL?.trim();
  if (!raw) return CANONICAL_BASE_URL;
  try {
    return new URL(raw).origin;
  } catch {
    return CANONICAL_BASE_URL;
  }
}
