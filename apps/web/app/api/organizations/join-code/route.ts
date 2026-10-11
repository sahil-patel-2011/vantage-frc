import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import {
  assertJoinCodeManager,
  decryptTeamPin,
  isJoinCodeRole,
  setTeamJoinCode,
} from "../../../../lib/team/join-code";
import {
  parseSecureJson,
  RequestSecurityError,
  securityErrorResponse,
} from "../../../../lib/security/request";

/**
 * The team join code (0708, defaults changed in 0721).
 *
 * POST bodies, one action each:
 *   { enabled: false }               turn the code off (pending code invites stop working)
 *   { enabled: true }                turn it on, keeping the code people may already have
 *   { pin?: "123456" }               a new code (random when blank); the old one stops working
 *   { role: "scout" | "viewer" }     what people who join with the code get
 * `role` may ride along with the first three.
 */
const input = z
  .object({
    orgId: z.string().uuid(),
    pin: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    enabled: z.boolean().optional(),
    role: z.enum(["scout", "viewer"]).optional(),
  })
  .strict();
function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "private, no-store" },
  });
}
async function actor() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    throw new RequestSecurityError(
      401,
      "Sign in to manage your team join code.",
    );
  return session.user.id;
}
/** A member who can't manage the code is told who can, with a 403 (it read as a broken form). */
function failure(error: unknown, fallback: string) {
  if (error instanceof Error && /can see or change the join code/.test(error.message)) {
    return json({ error: error.message, reason: "team_admin_only" }, { status: 403 });
  }
  return securityErrorResponse(error, fallback);
}
export async function GET(request: Request) {
  try {
    const userId = await actor(),
      orgId = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get("orgId"));
    return json(
      await withRls({ userId, orgId }, async (client) => {
        await assertJoinCodeManager(client, orgId);
        const result = await client.query<{
          encrypted_pin: string;
          enabled: boolean;
          joinRole: string | null;
        }>(
          `SELECT encrypted_pin, enabled, join_role::text AS "joinRole" FROM team_join_codes WHERE org_id=$1`,
          [orgId],
        );
        const code = result.rows[0];
        const organization = await client.query<{ teamNumber: number }>(
          'SELECT team_number AS "teamNumber" FROM organizations WHERE id=$1',
          [orgId],
        );
        return {
          pin: code ? decryptTeamPin(code.encrypted_pin) : null,
          enabled: code?.enabled ?? false,
          joinRole: isJoinCodeRole(code?.joinRole) ? code.joinRole : "viewer",
          teamNumber: organization.rows[0]?.teamNumber,
        };
      }),
    );
  } catch (error) {
    return failure(error, "Could not load the join code.");
  }
}
export async function POST(request: Request) {
  try {
    const userId = await actor(),
      body = await parseSecureJson(request, input);
    return json(
      await withRls({ userId, orgId: body.orgId }, async (client) => {
        await assertJoinCodeManager(client, body.orgId);
        if (body.enabled === false) {
          await client.query(
            "UPDATE team_join_codes SET enabled=false,updated_at=now() WHERE org_id=$1",
            [body.orgId],
          );
          await client.query(
            "UPDATE invites SET status='revoked' WHERE status='pending' AND id IN (SELECT invite_id FROM team_join_code_invites WHERE org_id=$1)",
            [body.orgId],
          );
          await client.query(
            "INSERT INTO membership_audit_events(org_id,actor_user_id,action) VALUES($1,$2,'team.join_code.disabled')",
            [body.orgId, userId],
          );
          return { enabled: false };
        }
        const existing = (
          await client.query<{ encrypted_pin: string }>(
            "SELECT encrypted_pin FROM team_join_codes WHERE org_id=$1 FOR UPDATE",
            [body.orgId],
          )
        ).rows[0];
        // Turning the code on (or only changing what joiners get) keeps the code itself, so one
        // already shared still works; a team with no code yet gets a new one.
        if (existing && !body.pin && (body.enabled === true || (body.role && body.enabled === undefined))) {
          await client.query(
            `UPDATE team_join_codes
                SET enabled = enabled OR $2::boolean,
                    join_role = COALESCE($3::org_role, join_role),
                    updated_at = now()
              WHERE org_id = $1`,
            [body.orgId, body.enabled === true, body.role ?? null],
          );
          await client.query(
            "INSERT INTO membership_audit_events(org_id,actor_user_id,action,metadata) VALUES($1,$2,$3,$4::jsonb)",
            [
              body.orgId,
              userId,
              body.enabled === true ? "team.join_code.enabled" : "team.join_code.role_changed",
              JSON.stringify({ joinRole: body.role ?? null }),
            ],
          );
          const state = (
            await client.query<{ enabled: boolean; joinRole: string }>(
              `SELECT enabled, join_role::text AS "joinRole" FROM team_join_codes WHERE org_id=$1`,
              [body.orgId],
            )
          ).rows[0];
          return {
            pin: decryptTeamPin(existing.encrypted_pin),
            enabled: state?.enabled ?? false,
            joinRole: isJoinCodeRole(state?.joinRole) ? state.joinRole : "viewer",
          };
        }
        const pin = await setTeamJoinCode(client, body.orgId, body.pin, { enable: true, role: body.role });
        await client.query(
          "INSERT INTO membership_audit_events(org_id,actor_user_id,action) VALUES($1,$2,'team.join_code.rotated')",
          [body.orgId, userId],
        );
        const role = (
          await client.query<{ joinRole: string }>(
            `SELECT join_role::text AS "joinRole" FROM team_join_codes WHERE org_id=$1`,
            [body.orgId],
          )
        ).rows[0]?.joinRole;
        return { pin, enabled: true, joinRole: isJoinCodeRole(role) ? role : "viewer" };
      }),
    );
  } catch (error) {
    return failure(error, "Could not update the join code.");
  }
}
