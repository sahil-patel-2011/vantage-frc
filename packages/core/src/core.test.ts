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
    expect(report.emailOtpReason).toMatch(/RESEND_API_KEY/);
    expect(report.passwordSignInAvailable).toBe(true);
    process.env.NODE_ENV = previous.nodeEnv;
    process.env.RESEND_API_KEY = previous.resend;
    process.env.AUTH_EMAIL_FROM = previous.from;
    process.env.DATABASE_AUTH_URL = previous.db;
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
});
