import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, haveIBeenPwned } from "better-auth/plugins";
import { authDb } from "@vantage/db/auth";
import { accounts, sessions, users, verifications } from "@vantage/db/schema";
import {
  auditAuthEvent,
  createEmailProvider,
  deterministicLocalOtp,
} from "./email";
import {
  envOrFallback,
  getAuthCapabilities,
  isEmailProviderConfigured,
  isGoogleAuthConfigured,
  resolveAuthBaseURL,
  resolveAuthTrustedOrigins,
} from "./access-policy";
import {
  WAITLIST_ONLY_MESSAGE,
  resolveAuthEmailAccess,
} from "./auth-access";

const authBaseURL = resolveAuthBaseURL();
const authTrustedOrigins = resolveAuthTrustedOrigins(authBaseURL);
const authSecret = envOrFallback(
  process.env["BETTER_AUTH_SECRET"],
  "local-development-secret-change-me",
);

function googleSocialProvider() {
  if (!isGoogleAuthConfigured()) return {};
  return {
    google: {
      clientId: process.env["GOOGLE_CLIENT_ID"]!,
      clientSecret: process.env["GOOGLE_CLIENT_SECRET"]!,
      // New Google users are gated by databaseHooks.user.create.before
      // (platform owner / existing / pending invite only).
      disableSignUp: false,
      disableImplicitSignUp: false,
    },
  } as const;
}

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
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: false,
    revokeSessionsOnPasswordReset: true,
    minPasswordLength: 12,
    onPasswordReset: async ({ user }) => {
      await auditAuthEvent({
        action: "password.reset",
        email: user.email,
        userId: user.id,
        success: true,
      });
      await createEmailProvider().sendSecurityNotice({
        email: user.email,
        subject: "Your Vantage password was reset",
        message:
          "Your Vantage password was reset and existing sessions were revoked. If this was not you, contact your team administrator.",
      });
    },
  },
  session: {
    additionalFields: {
      authMethod: { type: "string", required: false, input: false, defaultValue: "unknown" },
      email2faVerifiedAt: { type: "date", required: false, input: false },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      allowDifferentEmails: false,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const access = await resolveAuthEmailAccess(user.email);
          if (!access.allowed) {
            throw new Error(WAITLIST_ONLY_MESSAGE);
          }
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          const path = context?.path ?? "";
          const authMethod = path.includes("email-otp")
            ? "email_otp"
            : path === "/sign-in/email" || path === "/sign-up/email"
              ? "password"
              : path.includes("callback/google")
                ? "google"
                : "unknown";
          // Email-OTP as first factor already proved mailbox control; otherwise leave pending
          // unless Resend is missing / emergency bypass disables enforcement.
          const { isEmail2faEnforced } = await import("./email-2fa");
          const email2faVerifiedAt =
            authMethod === "email_otp" || !isEmail2faEnforced() ? new Date() : undefined;
          return { data: { ...session, authMethod, ...(email2faVerifiedAt ? { email2faVerifiedAt } : {}) } };
        },
      },
    },
  },
  socialProviders: googleSocialProvider(),
  plugins: [
    emailOTP({
      expiresIn: OTP_POLICY.expiresInSeconds,
      otpLength: 6,
      allowedAttempts: OTP_POLICY.allowedAttempts,
      storeOTP: "hashed",
      resendStrategy: "rotate",
      disableSignUp: true,
      rateLimit: {
        window: OTP_POLICY.requestWindowSeconds,
        max: OTP_POLICY.requestLimit,
      },
      sendVerificationOnSignUp: false,
      generateOTP:
        process.env.NODE_ENV === "production"
          ? undefined
          : ({ email, type }) => deterministicLocalOtp(email, type),
      sendVerificationOTP: async (message) => {
        if (!isEmailProviderConfigured()) {
          throw new Error("Email sign-in is unavailable until RESEND_API_KEY and AUTH_EMAIL_FROM are configured.");
        }
        const emailProvider = createEmailProvider();
        await emailProvider.sendOtp(message);
        await auditAuthEvent({
          action: "otp.sent",
          email: message.email,
          success: true,
          metadata: { type: message.type, provider: emailProvider.name },
        });
      },
    }),
    haveIBeenPwned({
      customPasswordCompromisedMessage: "Choose a password that has not appeared in known breaches.",
    }),
  ],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  // Cookie defaults: HttpOnly + SameSite=Lax; Secure when serving over HTTPS / production.
  // CSRF / Origin checks stay enabled (Better Auth defaults); trustedOrigins is the allowlist.
  advanced: {
    database: { generateId: "uuid" },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: authBaseURL.startsWith("https://") || process.env.NODE_ENV === "production",
      path: "/",
    },
  },
  secret: authSecret,
  baseURL: authBaseURL,
  trustedOrigins: authTrustedOrigins,
});

export * from "./email";
export * from "./email-notifications";
export * from "./mfa";
export * from "./access-policy";
export * from "./auth-access";
export * from "./bootstrap-owner";
export * from "./onboarding";
export * from "./email-2fa";
export { getAuthCapabilities };

export type OrgRole = "owner" | "admin" | "scout" | "viewer";

export function requireOrg(
  memberships: ReadonlyArray<{ orgId: string; role: OrgRole }>,
  requestedOrgId: string,
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

export async function getActiveContext(client: PoolClient, orgId: string): Promise<ActiveContext | null> {
  const result = await client.query<{
    org_id: string;
    active_event_key: string | null;
    active_location: string | null;
    set_by_user_id: string | null;
    set_at: Date;
  }>(`SELECT org_id, active_event_key, active_location, set_by_user_id, set_at
       FROM org_active_context WHERE org_id = $1`, [orgId]);
  const row = result.rows[0];
  return row
    ? {
        orgId: row.org_id,
        activeEventKey: row.active_event_key,
        activeLocation: row.active_location,
        setByUserId: row.set_by_user_id,
        setAt: row.set_at,
      }
    : null;
}

export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string) {
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
  },
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
      JSON.stringify(action.payload ?? {}),
    ],
  );
}

export { emitNotification } from "./notifications-emit";
export * from "./in-app-notifications";
export * from "./membership";
export * from "./capabilities";
export * from "./platform-admin";
