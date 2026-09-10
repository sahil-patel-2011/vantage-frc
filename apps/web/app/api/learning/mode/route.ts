// /api/learning/mode — the persisted learning-mode preference (0475).
//
// GET returns the caller's OWN preference rows for one org: the member default
// (surface IS NULL) plus any per-surface overrides. POST upserts (or clears)
// exactly one of the caller's own rows — RLS makes writing anyone else's
// preference impossible, and there is no admin override on purpose: fading must
// be legible, never imposed.

import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { isLearningSurface, type LearningSurface } from "../../../../lib/learning/learning-mode";
import { foldModePrefRows, type ModePrefs } from "../../../../lib/learning/mode-store";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "Learning mode request failed" },
    { status },
  );
}

type MembershipRow = { orgId: string; role: string };

async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<MembershipRow | null> {
  const result = await client.query<MembershipRow>(
    `SELECT m.org_id AS "orgId", m.role
       FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
      LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

async function readOwnPrefs(client: PoolClient, orgId: string, userId: string): Promise<ModePrefs> {
  const rows = await client.query<{ surface: string | null; enabled: boolean }>(
    `SELECT surface, enabled FROM learning_mode_prefs
      WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  return foldModePrefRows(rows.rows, isLearningSurface);
}

/** GET /api/learning/mode?orgId=… — the caller's own resolved preference rows. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      if (!membership) {
        return {
          status: "setup_required" as const,
          message: "Join a team to keep your learning-mode choice across devices.",
        };
      }
      const prefs = await readOwnPrefs(client, membership.orgId, session.user.id);
      return {
        status: "ready" as const,
        orgId: membership.orgId,
        role: membership.role,
        ...prefs,
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

type ModeWrite = {
  orgId: string;
  surface: LearningSurface | null;
  /** true/false stores a choice; null clears the row (back to inherited). */
  enabled: boolean | null;
};

function parseModeWrite(raw: unknown): ModeWrite {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "Invalid request body");
  const body = raw as Record<string, unknown>;
  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) throw new HttpError(400, "orgId is required");
  const surface = body.surface == null ? null : body.surface;
  if (surface !== null && !isLearningSurface(surface)) {
    throw new HttpError(400, "surface must be a learning surface or null for the member default");
  }
  const enabled = body.enabled == null ? null : body.enabled;
  if (enabled !== null && typeof enabled !== "boolean") {
    throw new HttpError(400, "enabled must be true, false, or null to clear the preference");
  }
  return { orgId, surface, enabled };
}

/** POST /api/learning/mode — upsert or clear ONE of the caller's own rows. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const input = parseModeWrite(await request.json().catch(() => null));

    const view = await withRls({ userId: session.user.id, orgId: input.orgId }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, input.orgId);
      if (!membership) throw new HttpError(403, "Organization membership required");

      if (input.enabled === null) {
        // Clear: back to inherited (member default, device value, or role default).
        await client.query(
          `DELETE FROM learning_mode_prefs
            WHERE org_id = $1::uuid AND user_id = $2::uuid
              AND ($3::text IS NULL AND surface IS NULL OR surface = $3::text)`,
          [input.orgId, session.user.id, input.surface],
        );
      } else if (input.surface === null) {
        // The two upserts differ only in conflict target: partial unique
        // indexes (0475) need matching ON CONFLICT predicates.
        await client.query(
          `INSERT INTO learning_mode_prefs (org_id, user_id, surface, enabled)
           VALUES ($1::uuid, $2::uuid, NULL, $3)
           ON CONFLICT (org_id, user_id) WHERE surface IS NULL
           DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
          [input.orgId, session.user.id, input.enabled],
        );
      } else {
        await client.query(
          `INSERT INTO learning_mode_prefs (org_id, user_id, surface, enabled)
           VALUES ($1::uuid, $2::uuid, $3, $4)
           ON CONFLICT (org_id, user_id, surface) WHERE surface IS NOT NULL
           DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
          [input.orgId, session.user.id, input.surface, input.enabled],
        );
      }

      const prefs = await readOwnPrefs(client, input.orgId, session.user.id);
      return { status: "ready" as const, orgId: input.orgId, role: membership.role, ...prefs };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
