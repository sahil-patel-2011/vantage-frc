import { describe, expect, it } from "vitest";
import {
  classifyInviteFlow,
  formatInviteRole,
  formatInviteTeamIdentity,
  inviteCanAccept,
  inviteEmptyCopy,
  inviteJoiningHeadline,
  inviteNextActions,
  inviteProfileRedirect,
  inviteSignInHref,
  inviteLegalRequired,
  inviteTeamName,
  normalizeInviteStatus,
} from "./invite-flow";

describe("inviteProfileRedirect", () => {
  const ready = { kind: "ready" as const, token: "tok_123", profileRequired: true, onboardingComplete: false };
  it("sends a new account straight to onboarding, coming back to this invite", () => {
    expect(inviteProfileRedirect(ready)).toBe(`/onboarding?next=${encodeURIComponent("/invite?token=tok_123")}`);
  });
  it("never bounces a finished profile, an unknown one, or a page that is not ready", () => {
    expect(inviteProfileRedirect({ ...ready, onboardingComplete: true })).toBeNull();
    expect(inviteProfileRedirect({ ...ready, onboardingComplete: null })).toBeNull();
    expect(inviteProfileRedirect({ ...ready, profileRequired: false })).toBeNull();
    expect(inviteProfileRedirect({ ...ready, kind: "auth_required" })).toBeNull();
    expect(inviteProfileRedirect({ ...ready, kind: "email_mismatch" })).toBeNull();
    expect(inviteProfileRedirect({ ...ready, token: "" })).toBeNull();
  });
});

describe("invite Soft-UI flow helpers", () => {
  it("tells people without an invite they are on the waitlist", () => {
    expect(inviteEmptyCopy("auth_required").description).toMatch(/waitlist/);
    const missing = inviteEmptyCopy("missing_token");
    expect(missing.title).toBe("Open your invite link");
    expect(missing.title).not.toMatch(/incomplete/);
    expect(missing.description).toMatch(/waitlist/);
    const actions = inviteNextActions({ kind: "missing_token" });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.href).toBe("/#waitlist");
    expect(actions[0]?.href).not.toContain("/signin");
  });

  it("formats clear team identity and roles in the one set of role words", () => {
    expect(formatInviteRole("owner")).toBe("Owner");
    expect(formatInviteRole("admin")).toBe("Mentor or coach");
    expect(formatInviteRole("scout")).toBe("Student");
    expect(formatInviteRole("viewer")).toBe("Parent or guest");
    expect(formatInviteRole("")).toBeNull();
    expect(
      formatInviteTeamIdentity({ orgName: "Vantage Robotics", teamNumber: 254, role: "scout" }),
    ).toBe("Team 254 · Vantage Robotics · Student");
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
    expect(inviteEmptyCopy("invalid").title).toMatch(/doesn.t work/i);
    expect(inviteNextActions({ kind: "ready", token: "tok" })).toEqual([]);
    const mismatch = inviteNextActions({ kind: "email_mismatch", token: "tok" });
    expect(mismatch[0]?.href).toContain("/signin");
    expect(mismatch[0]?.href).toContain("invite");
    expect(inviteSignInHref("abc")).toContain("/signin?next=");
    expect(decodeURIComponent(inviteSignInHref("abc"))).toContain("/invite?token=abc");
    const expired = inviteNextActions({ kind: "expired" });
    expect(expired[0]?.label).toBe("Already joined? Sign in");
    expect(expired[0]?.href).toBe("/signin");
    // Signed in already: no "Already joined? Sign in" (QA A3-10).
    expect(inviteNextActions({ kind: "expired", signedIn: true })).toEqual([]);
    expect(inviteNextActions({ kind: "revoked", signedIn: true })).toEqual([]);
  });

  it("names the team on dead links and says a replaced link has a newer one (QA A3-09/A3-10)", () => {
    const team = inviteTeamName({ orgName: "QA 3 Alpha", teamNumber: 9301 });
    expect(team).toBe("Team 9301 · QA 3 Alpha");
    expect(inviteEmptyCopy("expired", null, { team }).title).toBe("Your invite to Team 9301 · QA 3 Alpha has expired");
    expect(inviteEmptyCopy("revoked", null, { team }).title).toBe("Team 9301 · QA 3 Alpha cancelled this invite");
    const replaced = inviteEmptyCopy("replaced", null, { team });
    expect(replaced.title).toBe("A newer invite replaced this link");
    expect(replaced.description).toContain("Team 9301 · QA 3 Alpha sent a newer invite");
    expect(replaced.description).not.toMatch(/cut off/);
    expect(classifyInviteFlow({ token: "abc", loading: false, preview: null, replaced: true })).toBe("replaced");
  });

  it("tells only the signed-in invitee that they joined (QA A3-10)", () => {
    const team = "Team 9301";
    const stranger = inviteEmptyCopy("accepted", null, { team, signedIn: false });
    expect(stranger.title).toBe("This invite was already used");
    expect(stranger.description).not.toMatch(/you are on the team/i);
    expect(inviteNextActions({ kind: "accepted", orgId: "org-1" })).toEqual([
      expect.objectContaining({ id: "signin", href: "/signin" }),
    ]);
    expect(inviteEmptyCopy("accepted", null, { team, signedIn: true, isInvitee: true }).title).toBe(
      "You already joined Team 9301",
    );
    expect(inviteNextActions({ kind: "accepted", orgId: "org-1", signedIn: true, isInvitee: true })[0]).toMatchObject({
      label: "Open Home",
      href: "/dashboard?orgId=org-1",
    });
    expect(inviteEmptyCopy("accepted", null, { team, signedIn: true, isInvitee: false }).description).toMatch(/different account/);
    expect(inviteNextActions({ kind: "accepted", signedIn: true, isInvitee: false })).toEqual([]);
  });

  it("says a wrong account once, without a pill", () => {
    const copy = inviteEmptyCopy("email_mismatch");
    expect(copy.badge).toBe("");
    expect(copy.eyebrow).toBe("TEAM INVITATION");
  });
});

describe("formatInviteTeamIdentity", () => {
  it("does not repeat a team whose name is its number", () => {
    expect(formatInviteTeamIdentity({ orgName: "Team 6925", teamNumber: 6925, role: "scout" })).toBe("Team 6925 · Student");
    expect(formatInviteTeamIdentity({ orgName: "Ninjineers", teamNumber: 6925, role: "scout" })).toBe(
      "Team 6925 · Ninjineers · Student",
    );
  });
});
