import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint, withSavepointOrThrow } from "@vantage/db/savepoint";
import { initializeTeamDefaults } from "./defaults";
import { setTeamJoinCode } from "../team/join-code";

export type OwnerDefaultsOutcome = {
  /** Starter scout forms, finance categories and the owner's "My work" Home are in place. */
  defaults: boolean;
  /** A join code was made now. False when the team already had one, or codes are not configured. */
  joinCode: boolean;
};

const NOTHING: OwnerDefaultsOutcome = { defaults: false, joinCode: false };

/**
 * A team a platform admin provisions never passes through /claim, which is where a team gets its
 * published scout forms, finance categories, the owner's Home and a join code. This gives the
 * team the same start the moment its first owner is in: right after an admin seeds an existing
 * account as owner, or when the invited owner accepts.
 *
 * Runs as that owner (the caller's withRls client is the owner's own session, or a withRls the
 * admin route opens for the owner it just seeded), so row security applies exactly as on /claim:
 * forms are created_by the owner and the Home belongs to them. Anyone else accepting an invite
 * (a scout, a second owner) changes nothing. Idempotent, and never fails the caller's join: each
 * part sits in its own savepoint.
 */
export async function ensureFirstOwnerTeamDefaults(
  client: PoolClient,
  orgId: string,
  actorUserId: string,
): Promise<OwnerDefaultsOutcome> {
  const first = (
    await client.query<{ userId: string }>(
      `SELECT user_id::text AS "userId" FROM memberships
        WHERE org_id = $1::uuid AND role = 'owner'
        ORDER BY created_at LIMIT 1`,
      [orgId],
    )
  ).rows[0];
  if (!first || first.userId !== actorUserId) return NOTHING;

  let defaults = false;
  try {
    await withSavepointOrThrow(client, () => initializeTeamDefaults(client, orgId, { inTransaction: true }));
    defaults = true;
  } catch (error) {
    // The join still stands; the defaults are recoverable (Retry setup, or the next owner join).
    console.error("[team-defaults] could not add starter defaults", error instanceof Error ? error.message : typeof error);
  }

  // Codes are encrypted with the auth secret; without it the team still works by email invite,
  // and the owner can make a code from People once the server is configured.
  // The code is made OFF: it works only once the owner turns it on in Team admin (QA A3-01).
  const joinCode = process.env.BETTER_AUTH_SECRET
    ? await withSavepoint(
        client,
        async () => {
          const existing = await client.query("SELECT 1 FROM team_join_codes WHERE org_id = $1::uuid", [orgId]);
          if (existing.rowCount) return false;
          await setTeamJoinCode(client, orgId, undefined, { enable: false });
          return true;
        },
        false,
      )
    : false;

  return { defaults, joinCode };
}
