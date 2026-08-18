import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import {
  hashPhoneOtp,
  newPhoneOtpCode,
  normalizePhoneE164,
  phoneOtpMatches,
  phoneOtpSetupStatus,
  sendPhoneOtpSms,
} from "../../../../lib/account/phone-otp";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000, namespace: "phone-otp" });

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), phoneE164: z.string().optional() }),
  z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) }),
]);

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid phone OTP request." }, { status: 400 });

  if (!(await limiter.allow(session.user.id))) return rateLimitedResponse();

  try {
    if (parsed.data.action === "send") {
      const requestedPhone = parsed.data.phoneE164;
      const setup = phoneOtpSetupStatus();
      if (!setup.configured) {
        return Response.json({ error: setup.message, setupRequired: true }, { status: 503 });
      }
      const result = await withRls({ userId: session.user.id }, async (client) => {
        const row = await client.query<{ phoneE164: string | null }>(
          `SELECT phone_e164 AS "phoneE164" FROM profiles WHERE user_id=$1`,
          [session.user.id],
        );
        const phone = normalizePhoneE164(requestedPhone ?? row.rows[0]?.phoneE164);
        if (!phone) throw new Error("Save a phone number first.");
        const code = newPhoneOtpCode();
        await client.query(
          `INSERT INTO profiles(user_id, phone_e164)
           VALUES($1,$2)
           ON CONFLICT(user_id) DO UPDATE SET phone_e164=excluded.phone_e164, phone_verified_at=NULL`,
          [session.user.id, phone],
        );
        await client.query(
          `INSERT INTO user_phone_otp(user_id, phone_e164, code_hash, expires_at, attempts)
           VALUES($1,$2,$3,now() + interval '10 minutes',0)
           ON CONFLICT(user_id) DO UPDATE SET
             phone_e164=excluded.phone_e164,
             code_hash=excluded.code_hash,
             expires_at=excluded.expires_at,
             attempts=0,
             created_at=now()`,
          [session.user.id, phone, hashPhoneOtp(session.user.id, phone, code)],
        );
        const sent = await sendPhoneOtpSms(phone, code);
        if (!sent.ok) throw new Error(sent.error ?? "Could not send SMS.");
        return { sent: true };
      });
      return Response.json(result);
    }

    if (parsed.data.action !== "verify") {
      throw new Error("Unknown phone OTP action");
    }
    const code = parsed.data.code;
    const verified = await withRls({ userId: session.user.id }, async (client) => {
      const row = await client.query<{ phoneE164: string; codeHash: string; expiresAt: string; attempts: number }>(
        `SELECT phone_e164 AS "phoneE164", code_hash AS "codeHash",
                expires_at::text AS "expiresAt", attempts
         FROM user_phone_otp WHERE user_id=$1`,
        [session.user.id],
      );
      const otp = row.rows[0];
      if (!otp) throw new Error("Request a phone code first.");
      if (new Date(otp.expiresAt).getTime() < Date.now()) throw new Error("That code expired. Request a new one.");
      if (otp.attempts >= 8) throw new Error("Too many attempts. Request a new code.");
      const candidate = hashPhoneOtp(session.user.id, otp.phoneE164, code);
      if (!phoneOtpMatches(otp.codeHash, candidate)) {
        await client.query(`UPDATE user_phone_otp SET attempts=attempts+1 WHERE user_id=$1`, [session.user.id]);
        throw new Error("Invalid code.");
      }
      await client.query(
        `UPDATE profiles SET phone_e164=$2, phone_verified_at=now() WHERE user_id=$1`,
        [session.user.id, otp.phoneE164],
      );
      await client.query(`DELETE FROM user_phone_otp WHERE user_id=$1`, [session.user.id]);
      return { verified: true };
    });
    return Response.json(verified);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Phone OTP failed" },
      { status: 400 },
    );
  }
}
