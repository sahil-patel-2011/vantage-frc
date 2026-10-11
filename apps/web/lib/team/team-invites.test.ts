import { describe, expect, it } from "vitest";
import {
  formatInviteRowMeta,
  formatInviteRowStatus,
  inviteDeliveryBanner,
  inviteLinkButtonLabels,
  inviteSendResultCopy,
  normalizeInviteRowStatus,
} from "./team-invites";

describe("inviteLinkButtonLabels", () => {
  const base = { email: "sam@example.test", hasLink: false, copied: false, confirmingNewLink: false };
  it("starts every accessible name with the words on the button (WCAG 2.5.3)", () => {
    for (const state of [base, { ...base, hasLink: true }, { ...base, copied: true }, { ...base, confirmingNewLink: true }]) {
      const { label, accessibleName } = inviteLinkButtonLabels(state);
      expect(accessibleName.startsWith(label)).toBe(true);
      expect(accessibleName).toContain("sam@example.test");
    }
    expect(inviteLinkButtonLabels(base)).toEqual({ label: "Get a new link", accessibleName: "Get a new link for sam@example.test" });
    expect(inviteLinkButtonLabels({ ...base, hasLink: true }).label).toBe("Copy link");
  });
});

describe("team invite ledger helpers", () => {
  it("formats role and status without raw enums", () => {
    expect(normalizeInviteRowStatus("PENDING")).toBe("pending");
    expect(formatInviteRowStatus("pending")).toBe("Pending");
    expect(formatInviteRowMeta({ role: "scout", status: "pending" })).toBe("Team member · Pending");
  });

  it("does not claim email was sent in local or unconfigured mode", () => {
    expect(inviteSendResultCopy({ emailSent: true, delivery: "local" }).tone).toBe("ok");
    expect(inviteSendResultCopy({ emailSent: true, delivery: "local" }).message).not.toMatch(/emailed/i);
    expect(inviteSendResultCopy({ emailSent: true, delivery: "local" }).message).toMatch(/copy the link/i);
    expect(inviteSendResultCopy({ emailSent: false, delivery: "unconfigured" }).message).toMatch(/copy the link/i);
    expect(inviteSendResultCopy({ emailSent: true, delivery: "resend" }).tone).toBe("ok");
    expect(inviteSendResultCopy({ emailSent: false, delivery: "failed", emailError: "boom" }).message).toMatch(
      /boom/,
    );
  });

  it("surfaces an honest delivery banner", () => {
    expect(inviteDeliveryBanner("resend")).toBeNull();
    expect(inviteDeliveryBanner("local")?.title).toMatch(/email is off/i);
    expect(inviteDeliveryBanner("unconfigured")?.title).toMatch(/email is off/i);
  });
});
