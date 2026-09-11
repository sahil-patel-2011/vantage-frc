import { describe, expect, it } from "vitest";
import {
  classifyInviteFlow,
  formatInviteRole,
  formatInviteTeamIdentity,
  inviteCanAccept,
  inviteEmptyCopy,
  inviteJoiningHeadline,
  inviteNextActions,
  inviteSignInHref,
  inviteLegalRequired,
  normalizeInviteStatus,
} from "./invite-flow";

describe("invite Soft-UI flow helpers", () => {
  it("tells people without an invite they are on the waitlist", () => {
    expect(inviteEmptyCopy("auth_required").description).toMatch(/waitlist/);
    expect(inviteEmptyCopy("missing_token").description).toMatch(/waitlist/);
  });

  it("formats clear team identity and roles", () => {
    expect(formatInviteRole("admin")).toBe("Admin");
    expect(formatInviteRole("scout")).toBe("Scout");
    expect(formatInviteRole("")).toBeNull();
    expect(
      formatInviteTeamIdentity({ orgName: "Vantage Robotics", teamNumber: 254, role: "scout" }),
    ).toBe("Team 254 · Vantage Robotics · Scout");
  });

  it("asks for consent unless BOTH documents were already accepted", () => {
    expect(inviteLegalRequired({ termsAcceptedAt: null, privacyAcceptedAt: null })).toBe(true);
    expect(inviteLegalRequired({ termsAcceptedAt: "", privacyAcceptedAt: "" })).toBe(true);
    // Legacy 0163 combined checkbox is not evidence of a separate privacy consent.
    expect(
      inviteLegalRequired({ termsAcceptedAt: "2026-07-01T00:00:00.000Z", privacyAcceptedAt: null }),
    ).toBe(true);
    expect(
      inviteLegalRequired({
        termsAcceptedAt: "2026-07-01T00:00:00.000Z",
        privacyAcceptedAt: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("cannot accept until both boxes are ticked", () => {
    expect(
      inviteCanAccept({ termsAccepted: false, privacyAccepted: false, legalRequired: true, status: "pending" }),
    ).toBe(false);
    expect(
      inviteCanAccept({ termsAccepted: true, privacyAccepted: false, legalRequired: true, status: "pending" }),
    ).toBe(false);
    expect(
      inviteCanAccept({ termsAccepted: false, privacyAccepted: true, legalRequired: true, status: "pending" }),
    ).toBe(false);
    expect(
      inviteCanAccept({ termsAccepted: true, privacyAccepted: true, legalRequired: true, status: "pending" }),
    ).toBe(true);
    expect(
      inviteCanAccept({ termsAccepted: false, privacyAccepted: false, legalRequired: false, status: "pending" }),
    ).toBe(true);
    expect(
      inviteCanAccept({ termsAccepted: true, privacyAccepted: true, legalRequired: false, status: "expired" }),
    ).toBe(false);
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
    expect(
      classifyInviteFlow({
        token: "abc",
        loading: false,
        authRequired: true,
        preview: {
          orgName: "Team",
          teamNumber: 1,
          role: "scout",
          email: "a@example.com",
          status: "pending",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      }),
    ).toBe("auth_required");
    expect(classifyInviteFlow({ token: "", loading: false, preview: null })).toBe("missing_token");
    // A bare `/invite` (proxy.ts drops the query on its bounce) may still be
    // recovering the stashed token — flashing "link incomplete" there is a lie.
    expect(classifyInviteFlow({ token: "", loading: true, preview: undefined })).toBe("loading");
  });

  it("names the team being joined without inventing one", () => {
    expect(inviteJoiningHeadline({ orgName: "Vantage Robotics", teamNumber: 254 })).toBe(
      "You’re joining Team 254",
    );
    expect(inviteJoiningHeadline({ orgName: "Vantage Robotics", teamNumber: Number.NaN })).toBe(
      "You’re joining Vantage Robotics",
    );
    expect(inviteJoiningHeadline(null)).toBe("You’re joining a team");
  });

  it("keeps empty copy and next steps honest for exact-email security", () => {
    expect(inviteEmptyCopy("email_mismatch").description).toMatch(/sign out/i);
    expect(inviteEmptyCopy("expired").badge).toBe("Expired");
    expect(inviteEmptyCopy("invalid").title).toMatch(/invalid/i);
    expect(inviteNextActions({ kind: "ready", token: "tok" })).toEqual([]);
    const mismatch = inviteNextActions({ kind: "email_mismatch", token: "tok" });
    expect(mismatch[0]?.href).toContain("/signin");
    expect(mismatch[0]?.href).toContain("invite");
    expect(inviteSignInHref("abc")).toContain("/signin?next=");
    expect(decodeURIComponent(inviteSignInHref("abc"))).toContain("/invite?token=abc");
    const expired = inviteNextActions({ kind: "expired" });
    expect(expired[0]?.label).toBe("Check team access");
    expect(expired[0]?.detail).toMatch(/Your team/);
    expect(inviteEmptyCopy("accepted").description).toMatch(/choose your team/i);
  });
});
