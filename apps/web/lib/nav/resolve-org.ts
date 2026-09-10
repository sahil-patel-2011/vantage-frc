/** Client org context: URL wins, then `/api/me`, then persist so hub tabs keep working. */

export function readOrgIdFromSearch(search: string): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const value = new URLSearchParams(query).get("orgId")?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export function withPersistedOrgSearch(search: string, orgId: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("orgId") === orgId) {
    const serialized = params.toString();
    return serialized ? `?${serialized}` : "";
  }
  params.set("orgId", orgId);
  return `?${params.toString()}`;
}

/** Keep the current tab/filters; stamp the this team onto the URL. */
export function persistOrgIdInUrl(orgId: string): void {
  const id = orgId.trim();
  if (!id || typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("orgId") === id) return;
  url.searchParams.set("orgId", id);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

type MeOrgPayload = { orgId?: string | null };

/** GHA Playwright has no Postgres. A hung `/api/me` left hubs on Opening your team. */
const ME_ORG_TIMEOUT_MS = 8_000;

export async function fetchActiveOrgId(): Promise<string | null> {
  try {
    const response = await fetch("/api/me", {
      cache: "no-store",
      signal: AbortSignal.timeout(ME_ORG_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as MeOrgPayload;
    const id = typeof data.orgId === "string" ? data.orgId.trim() : "";
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
