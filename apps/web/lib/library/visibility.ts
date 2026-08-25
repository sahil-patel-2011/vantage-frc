/**
 * Pure mirror of the RLS sharing rules in migration 0489_team_library.sql.
 * The database is authoritative; this exists so the client can explain
 * "who can see this" honestly and so the rule itself is unit-tested.
 */

import type { LibraryVisibility } from "./types";

export type SharedItemLike = {
  visibility: LibraryVisibility;
  createdBy: string;
  /** Explicitly granted member ids (empty/undefined when team-wide). */
  grantedUserIds?: string[] | null;
};

export function isOrgManager(role: string): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Restricted items: creator + explicitly-granted members + org owners/admins.
 * Team-wide items: every org member. Matches library_*_visible_read exactly.
 */
export function canViewItem(item: SharedItemLike, viewerId: string, viewerRole: string): boolean {
  if (item.visibility === "team") return true;
  if (item.createdBy === viewerId) return true;
  if (isOrgManager(viewerRole)) return true;
  return (item.grantedUserIds ?? []).includes(viewerId);
}

/** Creator or owner/admin — matches the UPDATE/DELETE policies. */
export function canManageItem(createdBy: string, viewerId: string, viewerRole: string): boolean {
  return createdBy === viewerId || isOrgManager(viewerRole);
}

/** Honest audience summary for the sharing UI. */
export function describeAudience(
  item: SharedItemLike,
  memberNamesById: Map<string, string | null>,
): string {
  if (item.visibility === "team") return "Everyone on the team";
  const granted = item.grantedUserIds ?? [];
  if (!granted.length) return "Only you and team owners/admins";
  const names = granted
    .map((id) => memberNamesById.get(id) ?? "a member")
    .slice(0, 3);
  const extra = granted.length - names.length;
  const list = extra > 0 ? `${names.join(", ")} +${extra}` : names.join(", ");
  return `You, ${list}, and team owners/admins`;
}
