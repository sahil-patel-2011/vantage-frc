import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { authDb } from "@vantage/db/auth";
import { accounts, sessions, users, verifications } from "@vantage/db/schema";
import {
  auditAuthEvent,
  createEmailProvider,
  deterministicLocalOtp,
} from "./email";

const emailProvider = createEmailProvider();
const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);
export const OTP_POLICY = {
  expiresInSeconds: 300,
  allowedAttempts: 5,
  requestWindowSeconds: 60,
  requestLimit: 5,
} as const;

export const auth = betterAuth({
  database: drizzleAdapter(authDb, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications
    }
  }),
  emailAndPassword: { enabled: false },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  plugins: [
    emailOTP({
      expiresIn: OTP_POLICY.expiresInSeconds,
      otpLength: 6,
      allowedAttempts: OTP_POLICY.allowedAttempts,
      storeOTP: "hashed",
      resendStrategy: "rotate",
      rateLimit: {
        window: OTP_POLICY.requestWindowSeconds,
        max: OTP_POLICY.requestLimit,
      },
      generateOTP:
        process.env.NODE_ENV === "production"
          ? undefined
          : ({ email, type }) => deterministicLocalOtp(email, type),
      sendVerificationOTP: async (message) => {
        await emailProvider.sendOtp(message);
        await auditAuthEvent({
          action: "otp.sent",
          email: message.email,
          success: true,
          metadata: { type: message.type, provider: emailProvider.name },
        });
      },
    }),
  ],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  advanced: { database: { generateId: "uuid" } },
  secret: process.env.BETTER_AUTH_SECRET ?? "local-development-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001"
});

export * from "./email";

export type OrgRole = "owner" | "admin" | "scout" | "viewer";

export function requireOrg(
  memberships: ReadonlyArray<{ orgId: string; role: OrgRole }>,
  requestedOrgId: string
): { orgId: string; role: OrgRole } {
  const membership = memberships.find((entry) => entry.orgId === requestedOrgId);
  if (!membership) throw new Error("Organization access denied");
  return membership;
}

export type ActiveContext = {
  orgId: string;
  activeEventKey: string | null;
  activeLocation: string | null;
  setByUserId: string | null;
  setAt: Date;
};

export async function getActiveContext(
  client: PoolClient,
  orgId: string
): Promise<ActiveContext | null> {
  const result = await client.query<{
    org_id: string;
    active_event_key: string | null;
    active_location: string | null;
    set_by_user_id: string | null;
    set_at: Date;
  }>(
    `SELECT org_id, active_event_key, active_location, set_by_user_id, set_at
       FROM org_active_context WHERE org_id = $1`,
    [orgId]
  );
  const row = result.rows[0];
  return row
    ? {
        orgId: row.org_id,
        activeEventKey: row.active_event_key,
        activeLocation: row.active_location,
        setByUserId: row.set_by_user_id,
        setAt: row.set_at
      }
    : null;
}

export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function writeAdminAction(
  client: PoolClient,
  action: {
    actorUserId: string;
    action: string;
    targetOrgId?: string;
    targetUserId?: string;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO admin_actions
      (actor_user_id, action, target_org_id, target_user_id, payload)
     SELECT $1, $2, $3, $4, $5::jsonb
     WHERE is_platform_admin()`,
    [
      action.actorUserId,
      action.action,
      action.targetOrgId ?? null,
      action.targetUserId ?? null,
      JSON.stringify(action.payload ?? {})
    ]
  );
}

export async function emitNotification(
  client: PoolClient,
  input: { userId: string; orgId?: string; type: string; payload?: Record<string, unknown> }
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (user_id, org_id, type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [input.userId, input.orgId ?? null, input.type, JSON.stringify(input.payload ?? {})]
  );
}

export * from "./membership";
