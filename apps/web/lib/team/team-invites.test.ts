import { describe, expect, it } from "vitest";
import {
  formatInviteRowMeta,
  formatInviteRowStatus,
  inviteDeliveryBanner,
  inviteSendResultCopy,
  normalizeInviteRowStatus,
} from "./team-invites";

describe("team invite ledger helpers", () => {
  it("formats role and status without raw enums", () => {
    expect(normalizeInviteRowStatus("PENDING")).toBe("pending");
    expect(formatInviteRowStatus("pending")).toBe("Pending");
    expect(formatInviteRowMeta({ role: "scout", status: "pending" })).toBe("Scout · Pending");
  });

  it("does not claim email was sent in local or unconfigured mode", () => {
    expect(inviteSendResultCopy({ emailSent: true, delivery: "local" }).tone).toBe("warn");
    expect(inviteSendResultCopy({ emailSent: true, delivery: "local" }).message).toMatch(/copy the link/i);
    expect(inviteSendResultCopy({ emailSent: false, delivery: "unconfigured" }).tone).toBe("warn");
    expect(inviteSendResultCopy({ emailSent: true, delivery: "resend" }).tone).toBe("ok");
    expect(inviteSendResultCopy({ emailSent: false, delivery: "failed", emailError: "boom" }).message).toMatch(
      /boom/,
    );
  });

  it("surfaces an honest delivery banner", () => {
    expect(inviteDeliveryBanner("resend")).toBeNull();
    expect(inviteDeliveryBanner("local")?.title).toMatch(/do not email/i);
    expect(inviteDeliveryBanner("unconfigured")?.tone).toBe("setup");
  });
});
