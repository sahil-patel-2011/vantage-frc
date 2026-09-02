import { describe, expect, it } from "vitest";
import {
  EXIT_INVITE_TOKEN_PATTERN,
  classifyExitInvite,
  exitInviteExpiry,
  exitInviteLink,
  hashExitInviteToken,
  isExitInviteToken,
  newExitInviteToken,
  parseExitInviteResponse,
  type ResolvedExitInvite,
} from "./invites";

function invite(overrides: Partial<ResolvedExitInvite> = {}): ResolvedExitInvite {
  return {
    inviteId: "inv-1",
    orgId: "org-1",
    orgName: "Robo Raiders",
    teamNumber: 1234,
    memberName: "Ada Lovelace",
    memberUserId: "u-1",
    seasonYear: 2026,
    createdBy: "admin-1",
    expiresAt: "2026-06-01T00:00:00.000Z",
    usedAt: null,
    expired: false,
    ...overrides,
  };
}

describe("tokens", () => {
  it("generates distinct tokens inside the allow-listed charset", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const token = newExitInviteToken();
      expect(token).toMatch(EXIT_INVITE_TOKEN_PATTERN);
      seen.add(token);
    }
    expect(seen.size).toBe(50);
  });

  it("hashes to 64 lowercase hex chars and never stores the token itself", () => {
    const token = newExitInviteToken();
    const hash = hashExitInviteToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashExitInviteToken(token)).toBe(hash);
  });

  it("rejects malformed tokens", () => {
    expect(isExitInviteToken("short")).toBe(false);
    expect(isExitInviteToken("has space".padEnd(20, "x"))).toBe(false);
    expect(isExitInviteToken(null)).toBe(false);
    expect(isExitInviteToken(newExitInviteToken())).toBe(true);
  });

  it("builds an absolute link without a doubled slash", () => {
    expect(exitInviteLink("https://app.example.com/", "abcdefghijklmnop")).toBe(
      "https://app.example.com/exit-interview/respond?token=abcdefghijklmnop",
    );
  });

  it("expires 30 days out by default", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(exitInviteExpiry(now).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});

describe("classifyExitInvite", () => {
  it("maps unknown, used, expired, and open invites without leaking ids", () => {
    expect(classifyExitInvite(null)).toEqual({ status: "invalid" });
    expect(classifyExitInvite(invite({ usedAt: "2026-02-01T00:00:00.000Z" }))).toEqual({
      status: "used",
      orgName: "Robo Raiders",
      memberName: "Ada Lovelace",
    });
    expect(classifyExitInvite(invite({ expired: true })).status).toBe("expired");
    const open = classifyExitInvite(invite());
    expect(open).toMatchObject({ status: "open", seasonYear: 2026, teamNumber: 1234 });
    expect(JSON.stringify(open)).not.toContain("admin-1");
    expect(JSON.stringify(open)).not.toContain("inv-1");
  });
});

describe("parseExitInviteResponse", () => {
  it("normalises a filled form and defaults the graduation year to the invite season", () => {
    const parsed = parseExitInviteResponse(
      { role: "programming", yearsOnTeam: "3", highlights: " Led auto ", willingToMentor: true, contactEmail: "ada@example.com" },
      invite(),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        role: "programming",
        yearsOnTeam: 3,
        graduationYear: 2026,
        highlights: "Led auto",
        adviceForFuture: null,
        skillsToDocument: null,
        willingToMentor: true,
        contactEmail: "ada@example.com",
      },
    });
  });

  it("refuses an empty response and a bad email", () => {
    expect(parseExitInviteResponse({}, invite()).ok).toBe(false);
    expect(parseExitInviteResponse({ highlights: "x", contactEmail: "nope" }, invite()).ok).toBe(false);
  });

  it("falls back to 'other' for an unknown role", () => {
    const parsed = parseExitInviteResponse({ role: "ceo", adviceForFuture: "Start early" }, invite());
    expect(parsed.ok && parsed.value.role).toBe("other");
  });
});
