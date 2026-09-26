import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, haveIBeenPwned, oAuthProxy } from "better-auth/plugins";
import { authDb } from "@vantage/db/auth";
import { accounts, sessions, users, verifications } from "@vantage/db/schema";
import {
  auditAuthEvent,
  createEmailProvider,
  deterministicLocalOtp,
} from "./email";
import {
  email2faSatisfiedByAuthMethod,
  getAuthCapabilities,
  isEmailProviderConfigured,
  isGoogleAuthConfigured,
  resolveAuthBaseURL,
  resolveAuthSecret,
  resolveAuthTrustedOrigins,
  resolveGoogleOAuthCallbackOrigin,
  resolveSessionAuthMethod,
  runtimeEnv,
} from "./access-policy";
import {
  WAITLIST_ONLY_MESSAGE,
  resolveAuthEmailAccess,
} from "./auth-access";
import { desktopLinkSessions } from "./desktop-link-plugin";
import { productHandoffSessions } from "./product-handoff-plugin";

/**
 * Auth env is resolved lazily inside buildAuth(): `next build` imports every
 * route module during page-data collection with NODE_ENV=production, and an
 * import-time resolveAuthSecret() would make a credential-free build
 * impossible (the repo convention is that build and unit tests need no
 * credentials). The first runtime request constructs — and caches — the real
 * instance, and still fails loudly in production when the secret is missing.
 */

function googleSocialProvider(callbackOrigin: string | null) {
  if (!isGoogleAuthConfigured()) return {};
  return {
    google: {
      clientId: runtimeEnv("GOOGLE_CLIENT_ID"),
      clientSecret: runtimeEnv("GOOGLE_CLIENT_SECRET"),
      // Used for both the authorization URL and the code exchange, so the two
      // always name the address registered on the Google client.
      ...(callbackOrigin ? { redirectURI: `${callbackOrigin}/api/auth/callback/google` } : {}),
      prompt: "select_account",
      // New Google users are gated by databaseHooks.user.create.before
      // (platform owner / existing / pending invite only).
      disableSignUp: false,
      disableImplicitSignUp: false,
    },
  } as const;
}

/**
 * Sign-in codes. Guessing is stopped per code (five tries, then it is thrown away, and it expires
 * in five minutes), not per network: the request limit below is per IP address, and a classroom
 * signs in from one school address. At five a minute the sixth student in a room saw "Too many
 * tries" on their first press, so it is sized for a room of about thirty.
 */
export const OTP_POLICY = {
  expiresInSeconds: 300,
  allowedAttempts: 5,
  requestWindowSeconds: 60,
  requestLimit: 40,
} as const;

function buildAuth() {
  const authBaseURL = resolveAuthBaseURL();
  const authTrustedOrigins = resolveAuthTrustedOrigins(authBaseURL);
  const authSecret = resolveAuthSecret();
  const googleCallbackOrigin = isGoogleAuthConfigured() ? resolveGoogleOAuthCallbackOrigin() : null;
  return betterAuth({
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
    /**
     * Six, for a student on a shared shop laptop.
     *
     * It was twelve. Twelve is the right number for a password that is the
     * only thing between an attacker and an account, and that is not the
     * shape of this one: sign-up is closed, every account is provisioned or
     * invited by name, password sign-in is off by default at the
     * organization level, 2FA is available and can be required, and sign-in
     * attempts are rate limited. A team that wants a stronger floor turns
     * password sign-in off and uses Google or an emailed code, which is what
     * `DEFAULT_ORG_AUTH_POLICY` already does.
     *
     * Said plainly, because it is a real trade: six characters is weak on its
     * own, and the reason it is acceptable here is everything around it. The
     * platform-owner bootstrap secret in `bootstrap-owner.ts` stays at twelve
     * — that one is a deployment credential that can provision any team, and
     * nobody has to type it on a phone in a pit.
     */
    minPasswordLength: 6,
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
            // A 403 carrying the sentence, not a bare Error: that surfaced as
            // an empty 500, which the code screen could only call a server fault.
            throw new APIError("FORBIDDEN", { message: WAITLIST_ONLY_MESSAGE, code: "WAITLIST_ONLY" });
          }
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          const path = context?.path ?? "";
          const authMethod = resolveSessionAuthMethod(path);
          const { isEmail2faEnforced } = await import("./email-2fa");
          const email2faVerifiedAt = email2faSatisfiedByAuthMethod(authMethod, isEmail2faEnforced())
            ? new Date()
            : undefined;
          return { data: { ...session, authMethod, ...(email2faVerifiedAt ? { email2faVerifiedAt } : {}) } };
        },
      },
    },
  },
  socialProviders: googleSocialProvider(googleCallbackOrigin),
  plugins: [
    emailOTP({
      expiresIn: OTP_POLICY.expiresInSeconds,
      otpLength: 6,
      allowedAttempts: OTP_POLICY.allowedAttempts,
      storeOTP: "hashed",
      resendStrategy: "rotate",
      /**
       * Open, and gated exactly like Google.
       *
       * With sign-up disabled here, an invited student who had never signed in
       * had no user row, so every code they typed came back INVALID_OTP — and
       * the screen then told them codes only go to invited addresses, which
       * theirs was. Only Google could create an invited account, which strands
       * every student whose school account is not Google. A new user created
       * through this plugin still passes databaseHooks.user.create.before
       * (platform owner / existing user / pending invite, else waitlist), and
       * sendVerificationOTP below sends nothing to an address that gate would
       * refuse, so opening this does not let anyone mail an arbitrary inbox.
       */
      disableSignUp: false,
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
        // Codes go only to addresses that could sign in. The endpoint still
        // answers 200 either way, so this reveals nothing about who is invited.
        if (message.type === "sign-in") {
          const access = await resolveAuthEmailAccess(message.email);
          if (!access.allowed) {
            await auditAuthEvent({
              action: "otp.suppressed",
              email: message.email,
              success: false,
              metadata: { type: message.type, reason: access.reason },
            });
            return;
          }
        }
        if (!isEmailProviderConfigured()) {
          throw new Error(
            "Email sign-in is unavailable until RESEND_API_KEY and AUTH_EMAIL_FROM, or GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD, are configured.",
          );
        }
        if (message.type === "sign-in") {
          const access = await resolveAuthEmailAccess(message.email);
          if (!access.allowed) return;
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
    // Server-only endpoint (never HTTP-mounted) that mints a session for the
    // desktop shell after a browser-approved, verifier-proven code exchange.
    desktopLinkSessions(),
    productHandoffSessions(),
    // Google calls back on the registered host; this hands the encrypted result
    // to the host sign-in started on (main or Scouting) and sets the session
    // there. It skips itself when that host is the registered one.
    ...(googleCallbackOrigin ? [oAuthProxy({ productionURL: googleCallbackOrigin })] : []),
  ],
  rateLimit: {
    enabled: true,
    window: 60,
    // Per IP address and path: a team signing in together shares one school network.
    max: 60,
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
}

type AuthInstance = ReturnType<typeof buildAuth>;
let cachedAuth: AuthInstance | null = null;

export const auth: AuthInstance = new Proxy({} as AuthInstance, {
  get(_target, prop, receiver) {
    cachedAuth ??= buildAuth();
    return Reflect.get(cachedAuth, prop, receiver);
  },
  has(_target, prop) {
    cachedAuth ??= buildAuth();
    return prop in cachedAuth;
  },
});

export * from "./email";
export * from "./email-notifications";
export * from "./product-releases";
export * from "./release-notes-compose";
export * from "./mfa";
export * from "./access-policy";
export * from "./auth-access";
export * from "./bootstrap-owner";
export * from "./onboarding";
export * from "./email-2fa";
export * from "./recovery-email";
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

/** Raw invite tokens are 32-byte base64url (typically 43 chars). Accept a bounded charset so email clients cannot break accept. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function isInviteTokenShape(token: string | null | undefined): token is string {
  return Boolean(token && INVITE_TOKEN_PATTERN.test(token.trim()));
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
export * from "./claim-workspace";
export * from "./capabilities";
export * from "./admin-tenure";
export * from "./hub-access";
export * from "./role-profiles";
export * from "./platform-admin";
export * from "./platform-partners";

export * from "./legal";

/* The one switch that opens the doors — see public-signup.ts. */
export * from "./public-signup";
