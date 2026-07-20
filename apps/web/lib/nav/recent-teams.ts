/**
 * MRU team workspaces for the Soft-UI picker — device-local only, never DEMO orgs.
 */

const STORAGE_KEY = "vantage-recent-orgs";
const MAX_RECENT = 3;

export function listRecentOrgIds(limit = MAX_RECENT): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim())
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

/** Remember a real org switch — floats to the top of the picker. */
export function rememberRecentOrg(orgId: string, limit = MAX_RECENT): string[] {
  const id = orgId.trim();
  if (!id || typeof window === "undefined") return listRecentOrgIds(limit);
  const next = [id, ...listRecentOrgIds(limit).filter((row) => row !== id)].slice(0, Math.max(1, limit));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — picker still works without MRU */
  }
  return next;
}

export function sortMembershipsByRecent<T extends { orgId: string }>(
  memberships: T[],
  recentIds: string[] = listRecentOrgIds(),
): T[] {
  if (!memberships.length || !recentIds.length) return memberships;
  const rank = new Map(recentIds.map((id, index) => [id, index]));
  return [...memberships].sort((a, b) => {
    const aRank = rank.has(a.orgId) ? (rank.get(a.orgId) as number) : Number.POSITIVE_INFINITY;
    const bRank = rank.has(b.orgId) ? (rank.get(b.orgId) as number) : Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}
