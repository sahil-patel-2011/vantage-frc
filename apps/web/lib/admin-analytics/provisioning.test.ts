import { describe, expect, it } from "vitest";
import {
  confirmationDetails,
  confirmationLines,
  ownerInviteExpired,
  ownerProvisionMode,
  provisionConflictMessage,
  teamNumberTakenMessage,
  validateProvisionInput,
} from "./provisioning";

describe("validateProvisionInput", () => {
  const valid = {
    name: "  Circuit Breakers  ",
    slug: "circuit-breakers",
    teamNumber: 4926,
    ownerEmail: "Coach@Example.com ",
  };

  it("accepts and normalizes a complete form", () => {
    const result = validateProvisionInput(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: "Circuit Breakers",
        slug: "circuit-breakers",
        teamNumber: 4926,
        ownerEmail: "coach@example.com",
      });
    }
  });

  it("rejects each broken field with a specific message", () => {
    expect(validateProvisionInput({ ...valid, name: "  " })).toMatchObject({ ok: false });
    expect(validateProvisionInput({ ...valid, slug: "Bad Slug" })).toMatchObject({
      ok: false,
      error: "Slug must use lowercase letters, numbers, and hyphens",
    });
    expect(validateProvisionInput({ ...valid, teamNumber: 0 })).toMatchObject({ ok: false });
    expect(validateProvisionInput({ ...valid, teamNumber: 100000 })).toMatchObject({ ok: false });
    expect(validateProvisionInput({ ...valid, teamNumber: "12.5" })).toMatchObject({ ok: false });
    // QA A2-12: `true` became team #1. Only a whole number, or digits as typed, is a team number.
    for (const teamNumber of [true, "9e3", " 9202 ", [5], "", null, {}]) {
      expect(validateProvisionInput({ ...valid, teamNumber })).toMatchObject({ ok: false });
    }
    expect(validateProvisionInput({ ...valid, teamNumber: "9202" })).toMatchObject({ ok: true, value: { teamNumber: 9202 } });
    expect(validateProvisionInput({ ...valid, name: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(validateProvisionInput({ ...valid, ownerEmail: `${"a".repeat(250)}@x.org` })).toMatchObject({ ok: false });
    expect(validateProvisionInput({ ...valid, ownerEmail: "not-an-email" })).toMatchObject({
      ok: false,
      error: "A valid owner email is required",
    });
  });
});

describe("ownerProvisionMode", () => {
  it("seeds a verified account and invites everyone else", () => {
    expect(ownerProvisionMode({ id: "u1", emailVerified: true })).toBe("seeded");
    expect(ownerProvisionMode({ id: "u1", emailVerified: false })).toBe("invited");
    expect(ownerProvisionMode(null)).toBe("invited");
  });
});

describe("confirmationLines", () => {
  const base = { id: "org-1", name: "Circuit Breakers", slug: "circuit-breakers", teamNumber: 4926 };

  it("says whether anyone told an existing account they own a new team (A2-08)", () => {
    const quiet = confirmationLines({
      ...base,
      owner: { email: "coach@example.com", mode: "seeded", emailSent: false, delivery: "unconfigured" },
    }).join(" ");
    expect(quiet).toContain("is the owner now");
    expect(quiet).toContain("tell them yourself");
    expect(quiet).not.toContain("invite");
    const emailed = confirmationLines({
      ...base,
      owner: { email: "coach@example.com", mode: "seeded", emailSent: true, delivery: "resend" },
    }).join(" ");
    expect(emailed).toContain("We emailed them");
    // A local mailbox only logs the email: never counted as sent.
    expect(confirmationLines({ ...base, owner: { email: "c@example.com", mode: "seeded", emailSent: true, delivery: "local" } }).join(" "))
      .toContain("tell them yourself");
  });

  it("explains the invited path including manual delivery when email is unconfigured", () => {
    const lines = confirmationLines({
      ...base,
      owner: {
        email: "coach@example.com",
        mode: "invited",
        inviteUrl: "https://example.com/invite?token=x",
        inviteExpiresAt: "2026-08-31T00:00:00.000Z",
        emailSent: false,
      },
    });
    const text = lines.join(" ");
    expect(text).toContain("copy the invite link below");
    expect(text).toContain("coach@example.com");
    expect(text).not.toMatch(/slug|Billing row|seeded/);
  });

  it("notes when the invite email actually went out", () => {
    const lines = confirmationLines({
      ...base,
      owner: { email: "coach@example.com", mode: "invited", emailSent: true },
    });
    expect(lines.join(" ")).toContain("We emailed an owner invite");
  });
});

describe("confirmationDetails", () => {
  const base = { id: "org-1", name: "Circuit Breakers", slug: "circuit-breakers", teamNumber: 4926 };

  it("says whether the team's starter forms and Home are in place", () => {
    const seeded = confirmationDetails({ ...base, owner: { email: "c@example.com", mode: "seeded" }, teamDefaults: "ready" });
    expect(seeded.at(-1)).toBe("Starter scout forms, finance categories and the owner's Home are ready.");
    const invited = confirmationDetails({ ...base, owner: { email: "c@example.com", mode: "invited" }, teamDefaults: "on_owner_join" });
    expect(invited.at(-1)).toMatch(/added when the owner accepts/);
    const pending = confirmationDetails({ ...base, owner: { email: "c@example.com", mode: "seeded" }, teamDefaults: "pending" });
    expect(pending.at(-1)).toMatch(/could not be added/);
    expect(confirmationDetails({ ...base, owner: { email: "c@example.com", mode: "seeded" } })).toHaveLength(3);
  });
});

describe("provisionConflictMessage", () => {
  it("maps unique-constraint failures to friendly messages", () => {
    expect(
      provisionConflictMessage(
        'duplicate key value violates unique constraint "organizations_team_number_uq"',
      ),
    ).toBe("That team number already has a team. Find it in the list on the right.");
    expect(
      provisionConflictMessage('duplicate key value violates unique constraint "organizations_slug_key"'),
    ).toBe("Another team already uses that web address. Change it under Advanced, or check the team isn't already set up");
    expect(provisionConflictMessage("duplicate key value violates unique constraint \"other\"")).toBe(
      "A team with those details already exists",
    );
  });

  it("passes non-conflict errors through", () => {
    expect(provisionConflictMessage("Platform administrator access required")).toBeNull();
  });
});

describe("teamNumberTakenMessage", () => {
  it("names the team that has the number and where to find it (A2-07)", () => {
    expect(teamNumberTakenMessage(6925, "Ionic Bond")).toBe("Team 6925 already has a team (Ionic Bond). Find it in the list on the right.");
    expect(teamNumberTakenMessage(6925, "Team 6925")).toBe("Team 6925 already has a team. Find it in the list on the right.");
    expect(teamNumberTakenMessage(6925, "Team 6925")).not.toMatch(/web address|Advanced/);
  });
});

describe("ownerInviteExpired", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("tells an expired owner invite from a live one (A2-03)", () => {
    expect(ownerInviteExpired("2026-10-12T19:48:00Z", now)).toBe(true);
    expect(ownerInviteExpired("2026-10-14T19:48:00Z", now)).toBe(false);
    expect(ownerInviteExpired(null, now)).toBe(false);
  });
});
