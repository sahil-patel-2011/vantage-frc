/**
 * Product routes named in `docs/FEATURE_MAP.md`.
 *
 * The map mixes pages, query tabs, hashes, and a few non-HTTP pointers
 * (component files, env vars, CLI names). This parser keeps only visit-able
 * app paths so a fixture walk can cover the catalog without inventing URLs.
 */

const BACKTICK = /`([^`]+)`/g;
const FILE_SUFFIX = /\.(?:tsx?|jsx?|mjs|cjs|css|md|json|sql)$/i;

export function productRoutesFromFeatureMap(markdown: string): string[] {
  const seen = new Set<string>();
  for (const match of markdown.matchAll(BACKTICK)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const route = normalizeFeatureMapRoute(raw);
    if (route) seen.add(route);
  }
  return [...seen].sort();
}

export function normalizeFeatureMapRoute(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.includes("<")) return null;
  if (trimmed.startsWith("/api/")) return null;
  const withoutHash = trimmed.split("#")[0] ?? trimmed;
  const pathname = withoutHash.split("?")[0] ?? withoutHash;
  if (!pathname || pathname === "/") return null;
  if (FILE_SUFFIX.test(pathname)) return null;
  if (pathname.startsWith("/s/")) return null;
  return withoutHash;
}
