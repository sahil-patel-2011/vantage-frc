import { describe, expect, it } from "vitest";
import {
  classifyInviteFlow,
  formatInviteRole,
  formatInviteTeamIdentity,
  inviteCanAccept,
  inviteEmptyCopy,
  inviteNextActions,
  inviteTermsRequired,
  normalizeInviteStatus,
} from "./invite-flow";

describe("invite Soft-UI flow helpers", () => {
  it("formats clear team identity and roles", () => {
    expect(formatInviteRole("admin")).toBe("Admin");
    expect(formatInviteRole("")).toBeNull();
    expect(
      formatInviteTeamIdentity({ orgName: "Vantage Robotics", teamNumber: 254, role: "member" }),
    ).toBe("Team 254 · Vantage Robotics · Member");
  });

  it("requires terms only when not previously accepted", () => {
    expect(inviteTermsRequired(null)).toBe(true);
    expect(inviteTermsRequired("")).toBe(true);
    expect(inviteTermsRequired("2026-07-01T00:00:00.000Z")).toBe(false);
    expect(inviteCanAccept({ termsAccepted: false, termsRequired: true, status: "pending" })).toBe(
      false,
    );
    expect(inviteCanAccept({ termsAccepted: true, termsRequired: true, status: "pending" })).toBe(
      true,
    );
    expect(inviteCanAccept({ termsAccepted: false, termsRequired: false, status: "pending" })).toBe(
      true,
    );
    expect(inviteCanAccept({ termsAccepted: true, termsRequired: false, status: "expired" })).toBe(
      false,
    );
  });

  it("classifies expired / mismatch / ready shells without inventing access", () => {
    expect(normalizeInviteStatus("PENDING")).toBe("pending");
    expect(
      classifyInviteFlow({
        token: "abc",
        loading: false,
        emailMismatch: true,
        preview: undefined,
      }),
    ).toBe("email_mismatch");
    expect(
      classifyInviteFlow({
        token: "abc",
        loading: false,
        preview: {
          orgName: "Team",
          teamNumber: 1,
          role: "member",
          email: "a@example.com",
          status: "expired",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
      }),
    ).toBe("expired");
    expect(
      classifyInviteFlow({
        token: "abc",
        loading: false,
        preview: {
          orgName: "Team",
          teamNumber: 1,
          role: "member",
          email: "a@example.com",
          status: "pending",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      }),
    ).toBe("ready");
    expect(classifyInviteFlow({ token: "", loading: false, preview: null })).toBe("missing_token");
  });

  it("keeps empty copy and next steps honest for exact-email security", () => {
    expect(inviteEmptyCopy("email_mismatch").description).toMatch(/exact/i);
    expect(inviteEmptyCopy("expired").badge).toBe("Expired");
    expect(inviteEmptyCopy("invalid").title).toMatch(/invalid/i);
    const ready = inviteNextActions({ kind: "ready", token: "tok" });
    expect(ready[0]?.primary).toBe(true);
    expect(ready.some((a) => /exact-email/i.test(a.detail))).toBe(true);
    const mismatch = inviteNextActions({ kind: "email_mismatch", token: "tok" });
    expect(mismatch[0]?.href).toContain("/signin");
    expect(mismatch[0]?.href).toContain("invite");
  });
});
