import { describe, expect, it } from "vitest";
import {
  createInviteToken,
  deterministicLocalOtp,
  hashInviteToken,
  LocalMailboxProvider,
  localMailbox,
  OTP_POLICY,
  requireOrg,
  evaluateOrgAuthAccess,
  validateOrgAuthPolicy,
  totpAt,
  verifyTotp,
  isTotpReplay,
} from ".";
import { createOrganizationAsPlatformAdmin } from "./membership";
import type { PoolClient } from "@neondatabase/serverless";

describe("core tenancy helpers", () => {
  it("requires explicit organization membership", () => {
    expect(requireOrg([{ orgId: "org-a", role: "scout" }], "org-a")).toEqual({
      orgId: "org-a",
      role: "scout"
    });
    expect(() => requireOrg([], "org-a")).toThrow("access denied");
  });

  it("stores only deterministic invite token hashes", () => {
    const invite = createInviteToken();
    expect(invite.token).not.toBe(invite.tokenHash);
    expect(hashInviteToken(invite.token)).toBe(invite.tokenHash);
    expect(invite.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("organization authentication and MFA",()=>{
  const relaxed={allowPassword:false,allowGoogle:true,allowEmailOtp:true,mfaPolicy:"optional" as const,rememberedDeviceDays:14};
  it("keeps method and MFA policy organization-specific",()=>{
    expect(evaluateOrgAuthAccess(relaxed,"google",false,false).allowed).toBe(true);
    expect(evaluateOrgAuthAccess({...relaxed,allowGoogle:false},"google",true,true).reason).toBe("sign_in_method_not_allowed");
    expect(evaluateOrgAuthAccess({...relaxed,mfaPolicy:"required"},"email_otp",true,false).reason).toBe("mfa_step_up_required");
    expect(evaluateOrgAuthAccess({...relaxed,mfaPolicy:"required"},"email_otp",true,true).allowed).toBe(true);
    expect(()=>validateOrgAuthPolicy({...relaxed,allowGoogle:false,allowEmailOtp:false})).toThrow("At least one");
  });
  it("verifies authenticator windows and identifies replay",()=>{
    const secret="JBSWY3DPEHPK3PXP",at=1_700_000_000_000,current=totpAt(secret,at);
    expect(verifyTotp(secret,current.code,at)).toBe(current.step);
    expect(isTotpReplay(current.step,current.step)).toBe(true);
    expect(verifyTotp(secret,"000000",at)).toBeNull();
  });
});

describe("waitlist-only auth access policy", () => {
  it("reports public signup closed and gates email OTP when Resend is missing in production", async () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      resend: process.env.RESEND_API_KEY,
      from: process.env.AUTH_EMAIL_FROM,
      db: process.env.DATABASE_AUTH_URL,
    };
    process.env.NODE_ENV = "production";
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    process.env.DATABASE_AUTH_URL = "postgresql://example";
    const { getAuthCapabilities } = await import("./access-policy");
    const report = getAuthCapabilities();
    expect(report.publicSignup).toBe(false);
    expect(report.waitlistOnly).toBe(true);
    expect(report.emailOtpAvailable).toBe(false);
    expect(report.email2faEnforced).toBe(false);
    expect(report.emailOtpReason).toMatch(/RESEND_API_KEY/);
    expect(report.passwordSignInAvailable).toBe(true);
    process.env.NODE_ENV = previous.nodeEnv;
    process.env.RESEND_API_KEY = previous.resend;
    process.env.AUTH_EMAIL_FROM = previous.from;
    process.env.DATABASE_AUTH_URL = previous.db;
  });

  it("always allowlists the platform owner email for password and Google access", async () => {
    const previous = {
      owner: process.env.PLATFORM_OWNER_EMAIL,
      db: process.env.DATABASE_URL,
      auth: process.env.DATABASE_AUTH_URL,
      admin: process.env.DATABASE_ADMIN_URL,
    };
    process.env.PLATFORM_OWNER_EMAIL = "sahiljpatel2011@gmail.com";
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_AUTH_URL;
    delete process.env.DATABASE_ADMIN_URL;
    const { isPlatformOwnerEmail, resolveAuthEmailAccess } = await import("./auth-access");
    expect(isPlatformOwnerEmail("sahiljpatel2011@gmail.com")).toBe(true);
    expect(isPlatformOwnerEmail("SahilJPatel2011@gmail.com")).toBe(true);
    expect(isPlatformOwnerEmail("waitlist@example.com")).toBe(false);
    const access = await resolveAuthEmailAccess("sahiljpatel2011@gmail.com");
    expect(access).toEqual({
      allowed: true,
      reason: "platform_owner",
      email: "sahiljpatel2011@gmail.com",
    });
    const denied = await resolveAuthEmailAccess("random-waitlisted@example.com");
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("denied");
    process.env.PLATFORM_OWNER_EMAIL = previous.owner;
    process.env.DATABASE_URL = previous.db;
    process.env.DATABASE_AUTH_URL = previous.auth;
    process.env.DATABASE_ADMIN_URL = previous.admin;
  });

  it("treats blank auth env values as unset", async () => {
    const { envOrFallback } = await import("./access-policy");
    expect(envOrFallback("", "https://vantage-frc-web.vercel.app")).toBe("https://vantage-frc-web.vercel.app");
    expect(envOrFallback("  ", "fallback")).toBe("fallback");
    expect(envOrFallback("https://vantage-frc-web.vercel.app", "fallback")).toBe(
      "https://vantage-frc-web.vercel.app",
    );
  });

  it("resolves auth base URL and always trusts the production origin", async () => {
    const previous = {
      betterAuth: process.env.BETTER_AUTH_URL,
      appUrl: process.env.NEXT_PUBLIC_APP_URL,
      productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
      vercelUrl: process.env.VERCEL_URL,
      googleId: process.env.GOOGLE_CLIENT_ID,
      googleSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
    delete process.env.BETTER_AUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "vantage-frc-web.vercel.app";
    const { resolveAuthBaseURL, resolveAuthTrustedOrigins, isGoogleAuthConfigured } = await import(
      "./access-policy"
    );
    expect(resolveAuthBaseURL()).toBe("https://vantage-frc-web.vercel.app");
    expect(resolveAuthTrustedOrigins(resolveAuthBaseURL())).toContain(
      "https://vantage-frc-web.vercel.app",
    );
    process.env.GOOGLE_CLIENT_ID = "  ";
    process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-example";
    expect(isGoogleAuthConfigured()).toBe(false);

    process.env.BETTER_AUTH_URL = previous.betterAuth;
    process.env.NEXT_PUBLIC_APP_URL = previous.appUrl;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = previous.productionUrl;
    process.env.VERCEL_URL = previous.vercelUrl;
    process.env.GOOGLE_CLIENT_ID = previous.googleId;
    process.env.GOOGLE_CLIENT_SECRET = previous.googleSecret;
  });
});

describe("closed organization provisioning", () => {
  it("denies organization creation to non-platform users", async () => {
    const client = {
      query: async () => ({ rows: [{ allowed: false }], rowCount: 1 }),
    } as unknown as PoolClient;
    await expect(
      createOrganizationAsPlatformAdmin(client, "user", {
        name: "Test",
        slug: "test",
        teamNumber: 1,
        ownerEmail: "owner@example.com",
      }),
    ).rejects.toThrow("Platform administrator");
  });

  it("allows organization creation only when is_platform_admin is true", async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push(sql);
        if (sql.includes("is_platform_admin")) return { rows: [{ allowed: true }], rowCount: 1 };
        if (sql.includes("FROM users")) return { rows: [{ id: "owner-1" }], rowCount: 1 };
        if (sql.includes("INSERT INTO organizations")) return { rows: [{ id: "org-1" }], rowCount: 1 };
        if (sql.includes("INSERT INTO memberships")) return { rows: [], rowCount: 1 };
        if (sql.includes("INSERT INTO org_billing")) return { rows: [], rowCount: 1 };
        if (sql.includes("membership_audit_events")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0, params };
      },
    } as unknown as PoolClient;
    await expect(
      createOrganizationAsPlatformAdmin(client, "admin-user", {
        name: "Alpha",
        slug: "alpha",
        teamNumber: 254,
        ownerEmail: "owner@example.com",
      }),
    ).resolves.toBe("org-1");
    expect(calls.some((sql) => sql.includes("is_platform_admin"))).toBe(true);
  });
});

describe("platform admin privilege helper", () => {
  it("maps missing platform_admins row to 404 without leaking privilege wording", async () => {
    const { assertPlatformAdmin, isPlatformAdmin, PlatformAdminRequiredError, platformAdminDeniedResponse } =
      await import("./platform-admin");
    const denied = {
      query: async () => ({ rows: [{ allowed: false }], rowCount: 1 }),
    } as unknown as PoolClient;
    const allowed = {
      query: async () => ({ rows: [{ allowed: true }], rowCount: 1 }),
    } as unknown as PoolClient;

    expect(await isPlatformAdmin(denied)).toBe(false);
    expect(await isPlatformAdmin(allowed)).toBe(true);
    await expect(assertPlatformAdmin(denied)).rejects.toBeInstanceOf(PlatformAdminRequiredError);

    const response = platformAdminDeniedResponse(new PlatformAdminRequiredError());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });

    const orgEscalation = platformAdminDeniedResponse(new Error("Platform administrator access required"));
    expect(orgEscalation.status).toBe(404);
    await expect(orgEscalation.json()).resolves.toEqual({ error: "Not found" });
  });

  it("does not treat org-admin wording as platform privilege", async () => {
    const { platformAdminDeniedResponse } = await import("./platform-admin");
    const response = platformAdminDeniedResponse(new Error("Organization administrator access required"));
    expect(response.status).toBe(403);
  });
});
