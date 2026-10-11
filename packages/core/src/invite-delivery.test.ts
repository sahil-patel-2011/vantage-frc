import { describe, expect, it } from "vitest";
import type { EmailProvider } from "./email";
import { deliverInviteEmail, inviteEmailDeliveryMode } from "./membership";

function provider(name: string, sent: unknown[] = []): EmailProvider {
  return {
    name,
    sendOtp: async () => undefined,
    sendInvite: async (message) => {
      sent.push(message);
    },
    sendSecurityNotice: async () => undefined,
    sendFreeform: async () => undefined,
  };
}

describe("invite email delivery", () => {
  it("treats every real provider as sending, Gmail SMTP included (handed off by B)", () => {
    expect(inviteEmailDeliveryMode(provider("resend"))).toBe("resend");
    expect(inviteEmailDeliveryMode(provider("gmail-smtp"))).toBe("resend");
    expect(inviteEmailDeliveryMode(provider("local-mailbox"))).toBe("local");
    expect(inviteEmailDeliveryMode(provider("unconfigured"))).toBe("unconfigured");
  });

  it("actually sends through Gmail SMTP, with the inviter's name", async () => {
    const sent: Array<{ inviterName?: string | null }> = [];
    const result = await deliverInviteEmail(
      {
        email: "pat@example.test",
        organization: "Team 9301",
        role: "viewer",
        token: "t".repeat(43),
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterName: "Quinn Owner",
      },
      provider("gmail-smtp", sent),
    );
    expect(result).toEqual({ emailSent: true, delivery: "resend" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.inviterName).toBe("Quinn Owner");
  });
});
