/**
 * Is the signed-in person View only on this team? (role `viewer`, 0715)
 *
 * The database refuses their writes whatever the page shows; this only decides
 * whether a page offers an obvious write (Add task, Visit a pit, Add event) or a
 * calm "View only" note instead, so buttons do not refuse after the fact.
 */
/**
 * The sentence the API answers a refused write with (packages/db/src/view-only.ts).
 * Repeated here, not imported: client-reachable modules never import `@vantage/db`
 * (client-bundle-boundary.test.ts). view-only.test.ts keeps the two identical.
 */
export const VIEW_ONLY_MESSAGE =
  "View only — you can look but not change this. Ask the team owner or a mentor or coach for Student access.";

/** "Team member access" named a role no screen uses; the role words are in @vantage/core/role-words. */
export const VIEW_ONLY_CHIP_TITLE =
  "Parent or guest: you can look but not change anything on this team. Ask the team owner or a mentor or coach for Student access.";

type MembershipLike = { orgId: string; role?: string | null };

/** Same rule as Settings' role tier: the membership for this org, else the account's role. */
export function isViewOnlyIn(
  memberships: readonly MembershipLike[] | null | undefined,
  orgId: string | null | undefined,
  fallbackRole?: string | null,
): boolean {
  const membershipRole = orgId ? memberships?.find((row) => row.orgId === orgId)?.role : undefined;
  return (membershipRole ?? fallbackRole ?? "").trim().toLowerCase() === "viewer";
}

/** Reads `/api/me`'s answer (role for the requested team, plus every membership). */
export function viewOnlyFromMe(data: unknown, orgId: string | null | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  const me = data as { role?: unknown; memberships?: unknown };
  const memberships = Array.isArray(me.memberships)
    ? (me.memberships as Array<{ orgId?: unknown; role?: unknown }>)
        .filter((row) => typeof row?.orgId === "string")
        .map((row) => ({ orgId: row.orgId as string, role: typeof row.role === "string" ? row.role : null }))
    : [];
  return isViewOnlyIn(memberships, orgId, typeof me.role === "string" ? me.role : null);
}
