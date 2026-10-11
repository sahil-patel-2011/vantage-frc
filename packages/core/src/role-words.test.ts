import { describe, expect, it } from "vitest";
import {
  ACCESS_ROLES,
  ROLE_HINTS,
  ROLE_LABELS,
  roleLabel,
  roleOutranks,
  rolePhrase,
  selfDescribedWords,
  suggestedRoleFor,
} from "./role-words";
import { inviteEmailContent } from "./email";

describe("one role vocabulary (QA A3-06/07)", () => {
  it("names every stored role in the words the shell and roster already used", () => {
    expect(ROLE_LABELS).toEqual({
      owner: "Owner",
      admin: "Mentor or coach",
      scout: "Student",
      viewer: "Parent or guest",
    });
    for (const role of ACCESS_ROLES) expect(ROLE_HINTS[role].length).toBeGreaterThan(10);
  });

  it("never shows a stored enum value", () => {
    for (const role of ["scout", "admin", "viewer", " SCOUT "]) {
      expect(roleLabel(role)).not.toMatch(/^(scout|admin|viewer)$/i);
    }
    expect(roleLabel("mentor")).toBe("Member");
    expect(roleLabel(null)).toBe("Member");
    expect(rolePhrase("viewer")).toBe("a parent or guest");
  });

  it("ranks access so an invite only ever raises it", () => {
    expect(roleOutranks("admin", "scout")).toBe(true);
    expect(roleOutranks("viewer", "scout")).toBe(false);
    expect(roleOutranks("scout", "scout")).toBe(false);
  });

  it("keeps what someone says they are apart from their access", () => {
    expect(selfDescribedWords("parent")).toBe("a parent");
    expect(selfDescribedWords("other")).toBeNull();
    expect(suggestedRoleFor("parent")).toBe("viewer");
    expect(suggestedRoleFor("coach")).toBe("admin");
    expect(suggestedRoleFor("student")).toBe("scout");
  });
});

describe("invite email", () => {
  const now = Date.parse("2026-10-11T19:00:00Z");
  it("says the access in the app's words, who invited them and how long the link works", () => {
    const { subject, text } = inviteEmailContent(
      {
        email: "pat@example.test",
        organization: "QA 3 Alpha",
        role: "viewer",
        token: "t".repeat(43),
        expiresAt: new Date(now + 72 * 3_600_000),
        inviterName: "Quinn Owner",
      },
      now,
    );
    expect(subject).toBe("Join QA 3 Alpha on Vantage");
    expect(text).toContain("Quinn Owner invited you to join QA 3 Alpha on Vantage as Parent or guest.");
    expect(text).toContain("Can look, can't change anything.");
    expect(text).toContain("This link works for 3 days (until Oct 14, 7:00 PM UTC).");
    expect(text).not.toMatch(/\b(viewer|scout|admin)\b/);
    expect(text).not.toContain("GMT");
  });

  it("reads naturally without an inviter name", () => {
    const { text } = inviteEmailContent(
      { email: "s@example.test", organization: "Team 9301", role: "scout", token: "t".repeat(43), expiresAt: new Date(now + 24 * 3_600_000) },
      now,
    );
    expect(text.startsWith("You were invited to join Team 9301 on Vantage as Student.")).toBe(true);
    expect(text).toContain("works for 24 hours");
  });
});
