import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

/**
 * Beta program enrollment — one self-managed row per user (beta_enrollments,
 * migration 0449). RLS restricts every verb to the caller's own row.
 */

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

type BetaState = { enrolled: boolean; enrolledAt: string | null };

async function readState(userId: string): Promise<BetaState> {
  return withRls({ userId }, async (client) => {
    const result = await client.query<{ enrolledAt: Date | string }>(
      `SELECT enrolled_at AS "enrolledAt" FROM beta_enrollments WHERE user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    return {
      enrolled: Boolean(row),
      enrolledAt: row ? new Date(row.enrolledAt).toISOString() : null,
    };
  });
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    return privateJson(await readState(session.user.id));
  } catch (error) {
    return securityErrorResponse(error, "Could not load your beta status.");
  }
}

// Clients send `{}` (or `{ orgId }`) — parseSecureJson keeps the same-origin /
// content-type guards on both mutations.
const toggleSchema = z
  .object({
    orgId: z.string().uuid().nullish(),
  })
  .strict();

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  try {
    const body = await parseSecureJson(request, toggleSchema);
    const orgId = body.orgId ?? null;

    await withRls({ userId, ...(orgId ? { orgId } : {}) }, async (client) => {
      // RLS: user_id must be the caller; org_id (when set) must be a membership.
      await client.query(
        `INSERT INTO beta_enrollments (user_id, org_id)
         VALUES ($1::uuid, $2::uuid)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, orgId],
      );
    });
    return privateJson(await readState(userId));
  } catch (error) {
    return securityErrorResponse(error, "Could not join the beta.");
  }
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  try {
    await parseSecureJson(request, toggleSchema);
    await withRls({ userId }, async (client) => {
      await client.query(`DELETE FROM beta_enrollments WHERE user_id = $1::uuid`, [userId]);
    });
    return privateJson(await readState(userId));
  } catch (error) {
    return securityErrorResponse(error, "Could not leave the beta.");
  }
}
