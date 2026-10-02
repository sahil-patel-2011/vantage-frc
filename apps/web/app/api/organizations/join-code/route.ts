import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import {
  assertJoinCodeManager,
  decryptTeamPin,
  setTeamJoinCode,
} from "../../../../lib/team/join-code";
import {
  parseSecureJson,
  RequestSecurityError,
  securityErrorResponse,
} from "../../../../lib/security/request";

const input = z
  .object({
    orgId: z.string().uuid(),
    pin: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
function json(data: unknown) {
  return Response.json(data, {
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
        }>(
          "SELECT encrypted_pin,enabled FROM team_join_codes WHERE org_id=$1",
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
          teamNumber: organization.rows[0]?.teamNumber,
        };
      }),
    );
  } catch (error) {
    return securityErrorResponse(error, "Could not load the join code.");
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
        const pin = await setTeamJoinCode(client, body.orgId, body.pin);
        await client.query(
          "INSERT INTO membership_audit_events(org_id,actor_user_id,action) VALUES($1,$2,'team.join_code.rotated')",
          [body.orgId, userId],
        );
        return { pin, enabled: true };
      }),
    );
  } catch (error) {
    return securityErrorResponse(error, "Could not update the join code.");
  }
}
