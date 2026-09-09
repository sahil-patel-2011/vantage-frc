import { describe, expect, it } from "vitest";
import { describeAnnouncementEmail, shouldEmailAnnouncement } from "./notify-email";

describe("which announcements are worth an email", () => {
  /**
   * The in-app inbox gets every announcement. Email is reserved for the two
   * cases where the poster has said reaching people matters more than not
   * interrupting them — otherwise members filter the team's mail away and the
   * one that mattered goes with it.
   */
  it("emails only urgent or acknowledgement-required notices", () => {
    expect(shouldEmailAnnouncement({ priority: "urgent", requireAck: false })).toBe(true);
    expect(shouldEmailAnnouncement({ priority: "normal", requireAck: true })).toBe(true);
    expect(shouldEmailAnnouncement({ priority: "important", requireAck: true })).toBe(true);
    expect(shouldEmailAnnouncement({ priority: "normal", requireAck: false })).toBe(false);
    expect(shouldEmailAnnouncement({ priority: "important", requireAck: false })).toBe(false);
  });
});

describe("telling the poster what actually went out", () => {
  it("says how to email a notice that was not emailed", () => {
    expect(describeAnnouncementEmail({ attempted: false, reason: "not_urgent" })).toMatch(
      /Mark an announcement urgent/,
    );
  });

  /**
   * The poster is about to walk away believing the team has been told. Opt-outs
   * and failures belong on their screen, not only in a log.
   */
  it("names the members who will not get it", () => {
    const summary = describeAnnouncementEmail({
      attempted: true,
      candidates: 30,
      eligible: 19,
      sent: 19,
      failed: 0,
    });
    expect(summary).toContain("Emailed 19 of 30");
    expect(summary).toContain("11 have this category turned off");
  });

  it("reports failures rather than rounding them away", () => {
    const summary = describeAnnouncementEmail({
      attempted: true,
      candidates: 10,
      eligible: 10,
      sent: 8,
      failed: 2,
    });
    expect(summary).toContain("2 failed to send");
  });

  it("says the deployment cannot send at all, and that the post survived", () => {
    const summary = describeAnnouncementEmail({
      attempted: true,
      candidates: 10,
      eligible: 0,
      sent: 0,
      failed: 0,
      setupRequired: "Email delivery requires RESEND_API_KEY and AUTH_EMAIL_FROM.",
    });
    expect(summary).toContain("Posted to the team inbox");
    expect(summary).toContain("RESEND_API_KEY");
  });

  it("does not claim an audience that does not exist yet", () => {
    expect(describeAnnouncementEmail({ attempted: false, reason: "no_recipients" })).toMatch(
      /No other members/,
    );
  });
});
