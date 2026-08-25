import { describe, expect, it } from "vitest";
import {
  confirmationLines,
  ownerProvisionMode,
  provisionConflictMessage,
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

  it("summarizes the seeded path without any invite link", () => {
    const lines = confirmationLines({
      ...base,
      owner: { email: "coach@example.com", mode: "seeded" },
    });
    expect(lines.join(" ")).toContain("seeded as owner");
    expect(lines.join(" ")).not.toContain("invite");
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
    expect(text).toContain("one-time owner invite");
    expect(text).toContain("copy the one-time link");
  });

  it("notes when the invite email actually went out", () => {
    const lines = confirmationLines({
      ...base,
      owner: { email: "coach@example.com", mode: "invited", emailSent: true },
    });
    expect(lines.join(" ")).toContain("invite email was sent");
  });
});

describe("provisionConflictMessage", () => {
  it("maps unique-constraint failures to friendly messages", () => {
    expect(
      provisionConflictMessage(
        'duplicate key value violates unique constraint "organizations_team_number_uq"',
      ),
    ).toBe("That team number already has a workspace");
    expect(
      provisionConflictMessage('duplicate key value violates unique constraint "organizations_slug_key"'),
    ).toBe("That workspace slug is already taken");
    expect(provisionConflictMessage("duplicate key value violates unique constraint \"other\"")).toBe(
      "A workspace with those details already exists",
    );
  });

  it("passes non-conflict errors through", () => {
    expect(provisionConflictMessage("Platform administrator access required")).toBeNull();
  });
});
