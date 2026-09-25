import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

/**
 * The team's choice about Vantage training its own models on the team's AI activity
 * (Privacy Policy › How AI features use your data). Every member may read it; owners and admins
 * may change it (RLS on org_ai_training_choice, migration 0691). No row = allowed, the policy's
 * default.
 */

const bodySchema = z
  .object({
    orgId: z.string().uuid(),
    trainingAllowed: z.boolean(),
  })
  .strict();

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

/** The table is not there yet (a database behind on migrations): say so, never a 500. */
function missingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01";
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return privateJson({ error: "Your session ended. Sign in again." }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId || !z.string().uuid().safeParse(orgId).success) {
    return privateJson({ error: "Choose your team first." }, { status: 400 });
  }
  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = (
        await client.query<{ role: string }>(`SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
          orgId,
          session.user.id,
        ])
      ).rows[0]?.role;
      if (!role) throw Object.assign(new Error("Not on this team"), { status: 403 });
      const row = (
        await client.query<{ trainingAllowed: boolean; updatedAt: string | null }>(
          `SELECT training_allowed AS "trainingAllowed", updated_at::text AS "updatedAt"
             FROM org_ai_training_choice WHERE org_id = $1::uuid`,
          [orgId],
        )
      ).rows[0];
      return {
        available: true,
        trainingAllowed: row?.trainingAllowed ?? true,
        updatedAt: row?.updatedAt ?? null,
        canManage: role === "owner" || role === "admin",
      };
    });
    return privateJson(result);
  } catch (error) {
    if (missingTable(error)) return privateJson({ available: false, trainingAllowed: true, canManage: false });
    const status = (error as { status?: number }).status === 403 ? 403 : 400;
    return privateJson({ error: status === 403 ? "You are not on this team." : "Could not load this setting." }, { status });
  }
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return privateJson({ error: "Your session ended. Sign in again." }, { status: 401 });
  try {
    const body = await parseSecureJson(request, bodySchema);
    const saved = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const role = (
        await client.query<{ role: string }>(`SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
          body.orgId,
          session.user.id,
        ])
      ).rows[0]?.role;
      if (role !== "owner" && role !== "admin") {
        throw Object.assign(new Error("Only owners and admins can change this."), { status: 403 });
      }
      const row = (
        await client.query<{ trainingAllowed: boolean; updatedAt: string }>(
          `INSERT INTO org_ai_training_choice (org_id, training_allowed, updated_by, updated_at)
           VALUES ($1::uuid, $2::boolean, $3::uuid, now())
           ON CONFLICT (org_id) DO UPDATE SET
             training_allowed = EXCLUDED.training_allowed,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
           RETURNING training_allowed AS "trainingAllowed", updated_at::text AS "updatedAt"`,
          [body.orgId, body.trainingAllowed, session.user.id],
        )
      ).rows[0];
      return row;
    });
    return privateJson({ ok: true, trainingAllowed: saved?.trainingAllowed ?? body.trainingAllowed, updatedAt: saved?.updatedAt ?? null });
  } catch (error) {
    if ((error as { status?: number }).status === 403) {
      return privateJson({ error: "Only owners and admins can change this." }, { status: 403 });
    }
    if (missingTable(error)) {
      return privateJson({ error: "This setting isn't available yet. Try again later." }, { status: 503 });
    }
    return securityErrorResponse(error, "Could not save this setting.");
  }
}
