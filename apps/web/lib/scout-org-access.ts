import type { PoolClient } from "@neondatabase/serverless";
import { isWrongOrgDenied } from "@vantage/scouting";

/**
 * Shared scout feature org resolution. Explicit foreign orgId → hard deny (throw),
 * never soft setup_required. Pair with withRls({ userId, orgId? }).
 */
export class ScoutForbiddenError extends Error {
  readonly status = 403 as const;

  constructor(message = "forbidden") {
    super(message);
    this.name = "ScoutForbiddenError";
  }
}

export type ScoutOrgMembership = {
  orgId: string;
  teamNumber: number | null;
  role: string;
};

export function isScoutForbidden(error: unknown): boolean {
  if (error instanceof ScoutForbiddenError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.message === "forbidden" ||
    /organization access denied/i.test(error.message)
  );
}

export async function resolveScoutOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<ScoutOrgMembership | null> {
  if (requestedOrg) {
    const membership = await client.query<ScoutOrgMembership>(
      `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $1::uuid AND m.org_id = $2::uuid
       LIMIT 1`,
      [userId, requestedOrg],
    );
    if (isWrongOrgDenied(membership.rows.length)) {
      throw new ScoutForbiddenError("forbidden");
    }
    return membership.rows[0] ?? null;
  }

  const membership = await client.query<ScoutOrgMembership>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId],
  );
  return membership.rows[0] ?? null;
}

export function scoutForbiddenResponse(): Response {
  return Response.json({ error: "Organization access denied" }, { status: 403 });
}
