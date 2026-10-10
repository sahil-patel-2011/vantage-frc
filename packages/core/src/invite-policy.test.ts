import { describe, expect, it } from "vitest";
import { organizationInviteExpiresAt } from "./invite-policy";

describe("invitation expiry", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("expires new invitations exactly 24 hours later", () => {
    expect(organizationInviteExpiresAt(undefined, now).toISOString()).toBe("2026-10-08T12:00:00.000Z");
  });
  it("never permits a longer expiry or an invalid timestamp", () => {
    for (const hours of [168, Infinity, NaN]) {
      expect(organizationInviteExpiresAt(hours, now).getTime() - now).toBe(86_400_000);
    }
    expect(organizationInviteExpiresAt(2, now).getTime() - now).toBe(7_200_000);
  });
});
