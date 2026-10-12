import { afterEach, describe, expect, it, vi } from "vitest";
import { createWaitlistStore, waitlistBackend, waitlistSchema } from "./waitlist";
import { EmailedWaitlistStore, waitlistRequestMail, type WaitlistMail } from "./waitlist-email-store";

const request = waitlistSchema.parse({
  email: "Lead@Example.com",
  teamNumber: "6925",
  phone: "+12025550123",
  smsConsent: true,
  termsAccepted: true,
  privacyAccepted: true,
});

describe("backup-mode waitlist", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emails each request to the platform owner instead of saving it", async () => {
    const sent: WaitlistMail[] = [];
    const store = new EmailedWaitlistStore(async (mail) => {
      sent.push(mail);
    }, "owner@example.com");
    await store.upsert(request);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "owner@example.com", subject: "Waitlist request: team 6925" });
    expect(sent[0]!.text).toContain("Email: lead@example.com");
    expect(sent[0]!.text).toContain("Phone: +12025550123 (texts: yes)");
    expect(sent[0]!.text).toMatch(/backup mode/);
  });

  it("says when no phone was given", () => {
    const mail = waitlistRequestMail({ ...request, phone: "", smsConsent: false }, "owner@example.com", new Date("2026-10-12T00:00:00Z"));
    expect(mail.text).toContain("Phone: none given");
    expect(mail.text).toContain("Received: 2026-10-12T00:00:00.000Z");
  });

  it("is the backend in backup mode, ahead of any database URL", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("E2E_AUTH_FIXTURE", "");
    vi.stubEnv("VANTAGE_BACKUP_MODE", "1");
    vi.stubEnv("MARKETING_DATABASE_URL", "postgresql://vantage_marketing:secret@db.example.neon.tech/vantage");
    expect(waitlistBackend()).toBe("email");
    expect(createWaitlistStore()).toBeInstanceOf(EmailedWaitlistStore);
  });

  it("only adds: listing, marking and removing need the database", async () => {
    const store = new EmailedWaitlistStore(async () => undefined, "owner@example.com");
    expect(await store.list()).toEqual([]);
    expect(await store.markLaunchInvited()).toBeNull();
    expect(await store.markConverted()).toBeNull();
    expect(await store.remove()).toBe(false);
  });
});
