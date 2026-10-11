import { roleLabel } from "@vantage/core/role-words";
import { PROFILE_CAPABILITIES } from "./role-profile-copy";

type PersonRow = { name: string; email: string; role: string; capabilities?: string[] };

/**
 * Under a name on Team admin's People list: their access in the role words, then what else
 * they may do, by name. "1 extra power" said nothing; "Manages money" and "Scouting lead" say
 * it (QA A3-21).
 */
export function memberAccessLine(member: Pick<PersonRow, "role" | "capabilities">): string {
  const parts = [roleLabel(member.role)];
  const caps = member.capabilities ?? [];
  if (member.role !== "owner" && caps.includes("manage_budget")) parts.push("Manages money");
  if (member.role === "scout" || member.role === "viewer") {
    const named = PROFILE_CAPABILITIES.filter((capability) => caps.includes(capability.id)).map((capability) => capability.label);
    if (named.length === 1) parts.push(named[0]!);
    else if (named.length > 1) parts.push(`${named.length} extra powers`);
  }
  return parts.join(" · ");
}

/** Name or email contains the query (case-insensitive), and the role matches the filter (QA A3-24). */
export function filterMembers<T extends Pick<PersonRow, "name" | "email" | "role">>(members: T[], query: string, role: string): T[] {
  const needle = query.trim().toLowerCase();
  return members.filter(
    (member) =>
      (!role || member.role === role) &&
      (!needle || member.name?.toLowerCase().includes(needle) || member.email?.toLowerCase().includes(needle)),
  );
}
