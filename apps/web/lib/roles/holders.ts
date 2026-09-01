/**
 * Linking a role's free-text holder to a roster member.
 *
 * `team_roles.holder_name` is free text (migration 0130) and there is no `holder_user_id` column,
 * so a season of edits leaves "sam r", "Sam R." and "Sam Rodriguez" holding three different roles
 * that are really one person. Two halves of the fix, neither of which needs a schema change:
 *
 * - On write, `canonicalHolderName` stores the roster's own spelling when the typed name resolves
 *   to exactly one member. That is what stops the drift at the source.
 * - On read, `resolveRoleHolder` reports the member id the name points at, so coverage and
 *   staffing can be counted per person instead of per spelling.
 *
 * Matching reuses `matchPersonName`: only a single exact name match links, everything less certain
 * stays unlinked. We never silently attribute a role to the wrong student.
 */

import { matchPersonName, type RosterMember } from "../presence/match-names";
import type { TeamRole } from "./types";

export type HolderLink = TeamRole["holderLink"];

export type ResolvedHolder = {
  holderName: string | null;
  holderUserId: string | null;
  holderLink: HolderLink;
};

export function resolveRoleHolder(
  holderName: string | null | undefined,
  roster: RosterMember[],
): ResolvedHolder {
  const name = (holderName ?? "").trim();
  if (!name) return { holderName: null, holderUserId: null, holderLink: "unfilled" };

  const match = matchPersonName(name, roster);
  if (match.resolution === "auto" && match.autoUserId) {
    return {
      holderName: match.candidates[0]?.name || name,
      holderUserId: match.autoUserId,
      holderLink: "member",
    };
  }
  return {
    holderName: name,
    holderUserId: null,
    holderLink: match.resolution === "ambiguous" ? "ambiguous" : "unlinked",
  };
}

/** The name to STORE. Canonical spelling when we are certain, otherwise exactly what was typed. */
export function canonicalHolderName(
  holderName: string | null | undefined,
  roster: RosterMember[],
): string | null {
  return resolveRoleHolder(holderName, roster).holderName;
}

export function attachRoleHolders<T extends { holderName: string | null }>(
  roles: T[],
  roster: RosterMember[],
): Array<T & ResolvedHolder> {
  return roles.map((role) => ({ ...role, ...resolveRoleHolder(role.holderName, roster) }));
}

/**
 * Roles whose holder could not be linked to a member. This is the review queue that keeps the
 * free-text column honest — it is a question for a mentor, not something to auto-resolve.
 */
export function unlinkedHolders<T extends ResolvedHolder & { id: string; title: string }>(
  roles: T[],
): Array<{ id: string; title: string; holderName: string; holderLink: HolderLink }> {
  return roles
    .filter((role) => role.holderName && !role.holderUserId)
    .map((role) => ({
      id: role.id,
      title: role.title,
      holderName: role.holderName!,
      holderLink: role.holderLink,
    }));
}
