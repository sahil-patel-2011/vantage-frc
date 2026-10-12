import { describe, expect, it } from "vitest";
import { platformAdminAbilities, type PlatformAdmin } from "./platform-admins";
import { parseBanReason, parseTeamNumber, teamGovernanceRefusal, teamSlug } from "./team-governance";

function admin(overrides: Partial<PlatformAdmin>): PlatformAdmin {
  return {
    userId: "u",
    email: "a@example.test",
    name: "A",
    grantedAt: "2026-10-12",
    grantedByEmail: null,
    you: false,
    owner: false,
    ...overrides,
  };
}

describe("the platform owner (0733)", () => {
  it("only the owner adds, removes and hands over admins", () => {
    const owner = platformAdminAbilities([admin({ userId: "o", you: true, owner: true }), admin({ userId: "b" })]);
    expect(owner).toMatchObject({ isOwner: true, canAdd: true, canRemoveOthers: true, canRemoveSelf: false, canTransfer: true });

    const other = platformAdminAbilities([admin({ userId: "o", owner: true }), admin({ userId: "b", you: true })]);
    expect(other).toMatchObject({ isOwner: false, canAdd: false, canRemoveOthers: false, canRemoveSelf: true, canTransfer: false });
  });

  it("falls back to the old rules on a database without an owner yet", () => {
    const legacy = platformAdminAbilities([admin({ you: true }), admin({ userId: "b" })]);
    expect(legacy).toMatchObject({ canAdd: true, canRemoveOthers: true, canTransfer: true });
  });
});

describe("team requests and bans", () => {
  it("names a new team's web address after its name and number", () => {
    expect(teamSlug("Team 7777", 7777)).toBe("team-7777");
    expect(teamSlug("Robo Ravens", 7777)).toBe("robo-ravens-7777");
    expect(teamSlug("Équipe Élan!", 42)).toBe("equipe-elan-42");
    expect(teamSlug("###", 42)).toBe("team-42");
  });

  it("accepts only real team numbers and listed ban reasons", () => {
    expect(parseTeamNumber("6925")).toBe(6925);
    expect(() => parseTeamNumber("0")).toThrow(/between 1 and 99999/);
    expect(() => parseTeamNumber("100000")).toThrow();
    expect(parseBanReason("privacy")).toBe("privacy");
    expect(() => parseBanReason("spite")).toThrow(/why/i);
  });

  it("turns the database's refusals into sentences", () => {
    const owner = teamGovernanceRefusal(Object.assign(new Error("x"), { code: "42501", detail: "vantage:owner_only" }));
    expect(owner?.status).toBe(403);
    expect(owner?.message).toMatch(/platform owner/i);
    const missing = teamGovernanceRefusal(Object.assign(new Error("x"), { code: "42883" }));
    expect(missing?.status).toBe(503);
    expect(teamGovernanceRefusal(new Error("plain"))).toBeNull();
  });
});
