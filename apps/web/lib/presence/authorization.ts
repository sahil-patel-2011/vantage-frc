/**
 * Who may write to the presence record.
 *
 * Presence joins three things a team is sensitive about — who said they were coming, who was
 * actually in the room, and whose shop hours count. The rules were previously spelled out inline
 * in the route handler, which made them impossible to test and easy to drift between actions.
 * They live here as small pure decisions plus the three org-scoped lookups they depend on.
 *
 * Two invariants hold across every export:
 * - A member may only ever write their own row. Touching somebody else's RSVP, roll call, or shop
 *   session is a mentor action.
 * - Every lookup is scoped by `org_id`, so an id belonging to another team reads as "not found"
 *   rather than as a permission failure. A caller cannot use error text to probe for the existence
 *   of another team's members or sessions.
 */

import type { PoolClient } from "@neondatabase/serverless";

export class PresenceAuthError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 = 403,
  ) {
    super(message);
    this.name = "PresenceAuthError";
  }
}

export type PresenceAction =
  | "link-attendance-person"
  | "record-presence"
  | "link-hour-log"
  | "unlink-hour-log"
  | "unlink-presence";

export function canManagePresence(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** The team member behind the request, or a 403. Never reveals whether the org exists. */
export async function requirePresenceRole(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<string> {
  const member = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  const role = member.rows[0]?.role;
  if (!role) throw new PresenceAuthError("Organization access denied");
  return role;
}

/**
 * The target of a presence write must be on this team's roster. A user id from another org fails
 * here, before any write, and reads as "not on this team's roster" either way.
 */
export async function assertRosterMember(
  client: PoolClient,
  orgId: string,
  targetUserId: string,
): Promise<void> {
  const roster = await client.query(
    `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, targetUserId],
  );
  if (!roster.rowCount) throw new PresenceAuthError("That member is not on this team's roster.", 404);
}

/** The owner of a shop session, scoped to the org so another team's log id is simply not found. */
export async function loadHourLogOwner(
  client: PoolClient,
  orgId: string,
  hourLogId: string,
): Promise<string> {
  const owner = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM hour_logs WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, hourLogId],
  );
  const logOwner = owner.rows[0]?.userId;
  if (!logOwner) throw new PresenceAuthError("That shop session was not found.", 404);
  return logOwner;
}

export function assertCanRecordPresence(input: {
  role: string;
  actorId: string;
  targetUserId: string;
}): void {
  if (input.targetUserId === input.actorId) return;
  if (!canManagePresence(input.role)) {
    throw new PresenceAuthError("Only owners and admins can record presence for another member.");
  }
}

export function assertCanTouchHourLog(input: {
  role: string;
  actorId: string;
  ownerId: string;
  verb: "attach" | "detach";
}): void {
  if (input.ownerId === input.actorId) return;
  if (!canManagePresence(input.role)) {
    throw new PresenceAuthError(
      `Only owners and admins can ${input.verb} another member's shop session.`,
    );
  }
}

/**
 * Writing an identity onto a roll-call row, or deleting a presence record, is always a mentor
 * action — including on your own row. Self-attesting "that unmatched name was me" would let a
 * member claim someone else's hours, and self-deleting would let them erase an absence.
 */
export function assertCanManagePresence(input: { role: string; action: PresenceAction }): void {
  if (canManagePresence(input.role)) return;
  if (input.action === "link-attendance-person") {
    throw new PresenceAuthError("Only owners and admins can link roll-call names to members.");
  }
  throw new PresenceAuthError("Only owners and admins can remove a presence record.");
}
