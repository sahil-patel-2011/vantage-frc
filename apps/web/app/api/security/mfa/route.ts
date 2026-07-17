import {
  auth,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  regenerateRecoveryCodes,
  revokeMfa,
  verifyMfaStepUp,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function current() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

function rememberDeviceCookie(token: string, rememberDays: number, requestUrl: string) {
  const maxAge = Math.max(0, rememberDays) * 86_400;
  const secure =
    process.env.NODE_ENV === "production" || new URL(requestUrl).protocol === "https:";
  const parts = [
    `vantage_mfa_device=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function GET() {
  try {
    const session = await current();
    const result = await withRls({ userId: session.user.id }, async (client) => ({
      enrollment:
        (
          await client.query(
            `SELECT confirmed_at AS "confirmedAt",updated_at AS "updatedAt" FROM user_mfa_enrollments WHERE user_id=$1`,
            [session.user.id],
          )
        ).rows[0] ?? null,
      devices: (
        await client.query(
          `SELECT id,label,expires_at AS "expiresAt",last_used_at AS "lastUsedAt" FROM remembered_mfa_devices WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC`,
          [session.user.id],
        )
      ).rows,
    }));
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Security settings unavailable" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as {
      action: string;
      code?: string;
      orgId?: string;
      rememberDays?: number;
    };
    const result = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      let output: unknown;
      if (body.action === "begin") {
        output = await beginMfaEnrollment(client, { id: session.user.id, email: session.user.email });
      } else if (body.action === "confirm") {
        output = { recoveryCodes: await confirmMfaEnrollment(client, session.user.id, String(body.code ?? "")) };
      } else if (body.action === "regenerate") {
        output = {
          recoveryCodes: await regenerateRecoveryCodes(client, session.user.id, String(body.code ?? "")),
        };
      } else if (body.action === "step-up") {
        if (!body.orgId) throw new Error("orgId is required");
        output = await verifyMfaStepUp(client, {
          userId: session.user.id,
          orgId: body.orgId,
          sessionId: session.session.id,
          code: String(body.code ?? ""),
          rememberDays: body.rememberDays,
        });
      } else {
        throw new Error("Invalid MFA action");
      }
      await client.query(
        `INSERT INTO auth_policy_audit_events(org_id,actor_user_id,action,metadata) VALUES($1,$2,$3,'{}')`,
        [body.orgId ?? null, session.user.id, `mfa.${body.action}`],
      );
      return output;
    });

    // Never return the raw remember token in JSON — only set it as HttpOnly cookie.
    let payload = result;
    let setCookie: string | null = null;
    if (result && typeof result === "object" && "rememberToken" in result) {
      const { rememberToken, ...rest } = result as { rememberToken: string };
      payload = rest;
      setCookie = rememberDeviceCookie(rememberToken, Number(body.rememberDays ?? 0), request.url);
    }

    const response = Response.json(payload);
    if (setCookie) response.headers.append("set-cookie", setCookie);
    return response;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "MFA action failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as { deviceId?: string; revokeAll?: boolean };
    await withRls({ userId: session.user.id }, async (client) => {
      if (body.revokeAll) await revokeMfa(client, session.user.id);
      else if (body.deviceId) {
        await client.query(`UPDATE remembered_mfa_devices SET revoked_at=now() WHERE id=$1 AND user_id=$2`, [
          body.deviceId,
          session.user.id,
        ]);
      } else throw new Error("Select a device or revoke MFA");
      await client.query(`INSERT INTO auth_policy_audit_events(actor_user_id,action,metadata) VALUES($1,$2,'{}')`, [
        session.user.id,
        body.revokeAll ? "mfa.revoked" : "mfa.device_revoked",
      ]);
    });
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "MFA revocation failed" },
      { status: 400 },
    );
  }
}
