import { describe, expect, it, vi } from "vitest";
import { deliverInviteEmail, inviteEmailDeliveryMode } from "./membership";
import { inviteEmailText, type EmailProvider } from "./email";

const invite = { email: "scout@example.com", organization: "Team 254", role: "scout", token: "personal-token", expiresAt: new Date("2026-10-08T12:00:00Z") };
const provider = (name: string): EmailProvider => ({ name, sendInvite: vi.fn().mockResolvedValue(undefined), sendOtp: vi.fn(), sendSecurityNotice: vi.fn(), sendFreeform: vi.fn() });

describe("invitation delivery", () => {
  it("delivers through a configured Gmail provider instead of discarding the email", async () => {
    const gmail = provider("gmail-smtp");
    expect(inviteEmailDeliveryMode(gmail)).toBe("gmail-smtp");
    expect(await deliverInviteEmail(invite, gmail)).toEqual({ emailSent: true, delivery: "gmail-smtp" });
    expect(gmail.sendInvite).toHaveBeenCalledWith(invite);
  });
  it("reports failed delivery and never invents a send when unconfigured", async () => {
    const gmail = provider("gmail-smtp");
    vi.mocked(gmail.sendInvite).mockRejectedValue(new Error("delivery unavailable"));
    expect(await deliverInviteEmail(invite, gmail)).toMatchObject({ emailSent: false, delivery: "failed" });
    const missing = provider("unconfigured");
    expect(await deliverInviteEmail(invite, missing)).toEqual({ emailSent: false, delivery: "unconfigured" });
    expect(missing.sendInvite).not.toHaveBeenCalled();
  });
  it("names the recipient, access, password path and recorded expiry in the email", () => {
    const text = inviteEmailText(invite);
    expect(text).toContain("scout@example.com");
    expect(text).toContain("Team access: Team member");
    expect(text).toContain("password");
    expect(text).toContain(invite.expiresAt.toUTCString());
    expect(text).toContain("personal-token");
  });
});
