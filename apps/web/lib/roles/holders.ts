// Pure resolution of "who holds what" for other features to consume.
// A role held by a member resolves to that member's account; a role held by a
// name that is not on the roster resolves with userId null (label only). Roles
// with nobody in them are not holders and are omitted.

import type { RoleHolder, RoleMember, TeamRole } from "./types";

export function resolveRoleHolders(
  roles: TeamRole[],
  members: Array<Pick<RoleMember, "userId" | "name" | "email">>,
): RoleHolder[] {
  const byId = new Map(members.map((member) => [member.userId, member]));
  const holders: RoleHolder[] = [];
  for (const role of roles) {
    const member = role.holderUserId ? byId.get(role.holderUserId) : undefined;
    const name = (member?.name?.trim() || member?.email || role.holderName || "").trim();
    if (!name) continue;
    holders.push({
      roleId: role.id,
      title: role.title,
      subteam: role.subteam,
      isLead: role.isLead,
      userId: member ? member.userId : (role.holderUserId ?? null),
      name,
    });
  }
  return holders;
}

/**
 * Pick the member for a role title, e.g. "Safety captain". Matches the title
 * case-insensitively as a whole or as a leading phrase ("Safety captain (lead)").
 */
export function holderForTitle(holders: RoleHolder[], title: string): RoleHolder | null {
  const needle = title.trim().toLowerCase();
  if (!needle) return null;
  const exact = holders.find((holder) => holder.title.trim().toLowerCase() === needle);
  if (exact) return exact;
  return holders.find((holder) => holder.title.trim().toLowerCase().startsWith(needle)) ?? null;
}
