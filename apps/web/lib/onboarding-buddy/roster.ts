/**
 * Buddy pairings are member-to-member rows. Both sides must be this org's roster
 * user ids — never a free-text name, never a DEMO network identity.
 */

import type { PoolClient } from "@neondatabase/serverless";

export class OnboardingBuddyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "OnboardingBuddyError";
  }
}

/** Better Auth user ids are UUIDs. Anything else is not a roster member. */
export const ROSTER_USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseRosterUserId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new OnboardingBuddyError(`${label} is required`);
  const text = value.trim();
  if (!text) throw new OnboardingBuddyError(`${label} is required`);
  if (!ROSTER_USER_ID_RE.test(text)) {
    throw new OnboardingBuddyError(`${label} must be a roster member id`);
  }
  return text;
}

export function assertDistinctPair(newMemberId: string, buddyId: string): void {
  if (newMemberId === buddyId) {
    throw new OnboardingBuddyError("A member cannot be their own buddy");
  }
}

export function parseCreatePairingInput(body: {
  newMemberId?: unknown;
  buddyId?: unknown;
  notes?: unknown;
}): { newMemberId: string; buddyId: string; notes: string | null } {
  const newMemberId = parseRosterUserId(body.newMemberId, "New member");
  const buddyId = parseRosterUserId(body.buddyId, "Buddy");
  assertDistinctPair(newMemberId, buddyId);
  const notes =
    typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;
  return { newMemberId, buddyId, notes };
}

/**
 * Both people must currently sit on this org's memberships row. A user id from
 * another team, or a leftover DEMO string, reads as "not on this roster".
 */
export async function assertRosterMembers(
  client: PoolClient,
  orgId: string,
  userIds: string[],
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    throw new OnboardingBuddyError("Both people in a pairing must be on this team's roster.", 404);
  }
  const result = await client.query<{ userId: string }>(
    `SELECT user_id::text AS "userId"
     FROM memberships
     WHERE org_id = $1::uuid AND user_id = ANY($2::uuid[])`,
    [orgId, unique],
  );
  if ((result.rowCount ?? result.rows.length) !== unique.length) {
    throw new OnboardingBuddyError("Both people in a pairing must be on this team's roster.", 404);
  }
}

/** Bindings for the pairing insert — roster user ids only, in column order. */
export function pairingInsertParams(input: {
  orgId: string;
  newMemberId: string;
  buddyId: string;
  notes: string | null;
  createdBy: string;
}): [string, string, string, string | null, string] {
  return [input.orgId, input.newMemberId, input.buddyId, input.notes, input.createdBy];
}
