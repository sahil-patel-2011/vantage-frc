import { describe, expect, it } from "vitest";
import {
  INVITE_LIFETIME_CHOICES,
  ORGANIZATION_INVITE_MAX_HOURS,
  clampInviteHours,
  inviteLifetimeWords,
  organizationInviteExpiresAt,
} from "./invite-policy";

describe("invitation expiry", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("expires new invitations 24 hours later unless the owner picks longer", () => {
    expect(organizationInviteExpiresAt(undefined, now).toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(organizationInviteExpiresAt(72, now).toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(organizationInviteExpiresAt(168, now).toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });
  it("never permits more than a week or an invalid timestamp", () => {
    expect(organizationInviteExpiresAt(720, now).getTime() - now).toBe(ORGANIZATION_INVITE_MAX_HOURS * 3_600_000);
    for (const hours of [Infinity, NaN]) {
      expect(organizationInviteExpiresAt(hours, now).getTime() - now).toBe(86_400_000);
    }
    expect(organizationInviteExpiresAt(2, now).getTime() - now).toBe(7_200_000);
    expect(clampInviteHours(0)).toBe(1);
    expect(clampInviteHours(null)).toBe(24);
  });
  it("offers a day by default, up to a week, in plain words", () => {
    expect(INVITE_LIFETIME_CHOICES[0]!.hours).toBe(24);
    expect(Math.max(...INVITE_LIFETIME_CHOICES.map((choice) => choice.hours))).toBe(ORGANIZATION_INVITE_MAX_HOURS);
    expect(inviteLifetimeWords(24)).toBe("24 hours");
    expect(inviteLifetimeWords(72)).toBe("3 days");
    expect(inviteLifetimeWords(168)).toBe("7 days");
    expect(inviteLifetimeWords(1)).toBe("1 hour");
  });
});
