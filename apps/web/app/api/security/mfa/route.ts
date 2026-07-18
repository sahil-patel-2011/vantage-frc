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
import { z } from "zod";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const mutationLimiter = createRateLimiter({ limit: 12, windowMs: 5 * 60_000, namespace: "account-mfa" });
const verificationCode = z.string().trim().min(6).max(32).regex(/^[0-9A-Za-z-]+$/);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin") }).strict(),
  z.object({ action: z.literal("confirm"), code: verificationCode }).strict(),
  z.object({ action: z.literal("regenerate"), code: verificationCode }).strict(),
  z.object({ action: z.literal("step-up"), code: verificationCode, orgId: z.string().uuid(), rememberDays: z.number().int().min(0).max(30).optional() }).strict(),
]);
const revokeSchema = z.union([
  z.object({ revokeAll: z.literal(true) }).strict(),
  z.object({ deviceId: z.string().uuid() }).strict(),
]);

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

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
    return privateJson(result);
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
    if (!(await mutationLimiter.allow(`${session.user.id}:${anonymizeIp(clientIp(request))}`))) {
      return rateLimitedResponse("Too many security attempts. Wait a few minutes and try again.");
    }
    const body = await parseSecureJson(request, actionSchema);
    const orgId = "orgId" in body ? body.orgId : undefined;
    const rememberDays = "rememberDays" in body ? body.rememberDays : undefined;
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      let output: unknown;
      if (body.action === "begin") {
        output = await beginMfaEnrollment(client, { id: session.user.id, email: session.user.email });
      } else if (body.action === "confirm") {
        output = { recoveryCodes: await confirmMfaEnrollment(client, session.user.id, body.code) };
      } else if (body.action === "regenerate") {
        output = {
          recoveryCodes: await regenerateRecoveryCodes(client, session.user.id, body.code),
        };
      } else if (body.action === "step-up") {
        output = await verifyMfaStepUp(client, {
          userId: session.user.id,
          orgId: body.orgId,
          sessionId: session.session.id,
          code: body.code,
          rememberDays: body.rememberDays,
        });
      } else {
        throw new Error("Invalid MFA action");
      }
      await client.query(
        `INSERT INTO auth_policy_audit_events(org_id,actor_user_id,action,metadata) VALUES($1,$2,$3,'{}')`,
        [orgId ?? null, session.user.id, `mfa.${body.action}`],
      );
      return output;
    });

    // Never return the raw remember token in JSON — only set it as HttpOnly cookie.
    let payload = result;
    let setCookie: string | null = null;
    if (result && typeof result === "object" && "rememberToken" in result) {
      const { rememberToken, ...rest } = result as { rememberToken: string };
      payload = rest;
      setCookie = rememberDeviceCookie(rememberToken, Number(rememberDays ?? 0), request.url);
    }

    const response = privateJson(payload);
    if (setCookie) response.headers.append("set-cookie", setCookie);
    return response;
  } catch (error) {
    return securityErrorResponse(error, "MFA action failed");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await current();
    if (!(await mutationLimiter.allow(`${session.user.id}:${anonymizeIp(clientIp(request))}`))) {
      return rateLimitedResponse("Too many security changes. Wait a few minutes and try again.");
    }
    const body = await parseSecureJson(request, revokeSchema);
    await withRls({ userId: session.user.id }, async (client) => {
      if ("revokeAll" in body) await revokeMfa(client, session.user.id);
      else {
        await client.query(`UPDATE remembered_mfa_devices SET revoked_at=now() WHERE id=$1 AND user_id=$2`, [
          body.deviceId,
          session.user.id,
        ]);
      }
      await client.query(`INSERT INTO auth_policy_audit_events(actor_user_id,action,metadata) VALUES($1,$2,'{}')`, [
        session.user.id,
        "revokeAll" in body ? "mfa.revoked" : "mfa.device_revoked",
      ]);
    });
    return privateJson({ success: true });
  } catch (error) {
    return securityErrorResponse(error, "MFA revocation failed");
  }
}
