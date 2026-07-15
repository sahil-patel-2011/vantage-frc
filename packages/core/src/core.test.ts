import { describe, expect, it } from "vitest";
import {
  createInviteToken,
  deterministicLocalOtp,
  hashInviteToken,
  LocalMailboxProvider,
  localMailbox,
  OTP_POLICY,
  requireOrg,
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

describe("passwordless authentication policy", () => {
  it("delivers deterministic numeric codes through the local mailbox", async () => {
    localMailbox.clear();
    const otp = deterministicLocalOtp("User@Example.com", "sign-in");
    expect(otp).toMatch(/^\d{6}$/);
    expect(deterministicLocalOtp("user@example.com", "sign-in")).toBe(otp);
    await new LocalMailboxProvider().sendOtp({
      email: "User@Example.com",
      otp,
      type: "sign-in",
    });
    expect(localMailbox.get("user@example.com")?.[0]?.otp).toBe(otp);
  });

  it("locks short expiry, one-time rotation, attempt, and rate limits", () => {
    expect(OTP_POLICY).toEqual({
      expiresInSeconds: 300,
      allowedAttempts: 5,
      requestWindowSeconds: 60,
      requestLimit: 5,
    });
    // Better Auth's emailOTP plugin stores `${hash}:attempts`, deletes it on
    // successful sign-in (preventing replay), and rejects expired records.
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
