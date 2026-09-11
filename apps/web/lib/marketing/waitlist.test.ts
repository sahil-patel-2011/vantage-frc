import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryWaitlistStore, WaitlistUnavailableError, createWaitlistStore, waitlistSchema } from "./waitlist";
import { waitlistUnavailableCopy } from "./waitlist-copy";

describe("waitlist validation", () => {
  it("normalizes valid input", () => {
    const result = waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true,
      email: "  Drive@Example.COM ",
      teamNumber: "254",
      phone: "+12025550123",
      smsConsent: true,
      website: "",
    });
    expect(result.email).toBe("drive@example.com");
    expect(result.teamNumber).toBe(254);
  });

  it.each([
    { email: "x@example.com", teamNumber: 0 },
    { email: "invalid", teamNumber: 254 },
    { email: "x@example.com", teamNumber: 254, phone: "202-555-0123", smsConsent: true },
    { email: "x@example.com", teamNumber: 254, phone: "+12025550123", smsConsent: false },
    { email: "x@example.com", teamNumber: 254, website: "bot.example" },
    { email: "x@example.com", teamNumber: 254, termsAccepted: false },
    { email: "x@example.com", teamNumber: 254 },
  ])("rejects malformed or non-consensual input: %#", (input) => {
    expect(waitlistSchema.safeParse(input).success).toBe(false);
  });

  it("requires termsAccepted true", () => {
    const denied = waitlistSchema.safeParse({
      email: "ok@example.com",
      teamNumber: 254,
      termsAccepted: false,
      privacyAccepted: true,
    });
    expect(denied.success).toBe(false);
    const accepted = waitlistSchema.safeParse({
      email: "ok@example.com",
      teamNumber: 254,
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(accepted.success).toBe(true);
  });

  it("requires privacyAccepted true", () => {
    const denied = waitlistSchema.safeParse({
      email: "ok@example.com",
      teamNumber: 254,
      termsAccepted: true,
      privacyAccepted: false,
    });
    expect(denied.success).toBe(false);
  });
});

describe("duplicate-safe persistence", () => {
  const store = new MemoryWaitlistStore();
  beforeEach(() => store.clear());

  it("updates an existing email without disclosing a duplicate", async () => {
    await store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true, email: "a@example.com", teamNumber: 1 }));
    await expect(store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true,
      email: "A@example.com",
      teamNumber: 999,
      phone: "+12025550123",
      smsConsent: true,
    }))).resolves.toBeUndefined();
    expect(store.get("a@example.com")?.teamNumber).toBe(999);
    expect(store.get("a@example.com")?.smsConsent).toBe(true);
  });
});

describe("admin waitlist tools", () => {
  const store = new MemoryWaitlistStore();
  beforeEach(() => store.clear());

  it("lists, filters, and marks entries without assuming sort order for equal timestamps", async () => {
    await store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true, email: "alpha@example.com", teamNumber: 254 }));
    await store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true, email: "beta@example.com", teamNumber: 9999 }));

    const filtered = await store.list({ q: "9999" });
    expect(filtered.map((row) => row.email)).toEqual(["beta@example.com"]);

    const all = await store.list();
    expect(new Set(all.map((row) => row.email))).toEqual(new Set(["alpha@example.com", "beta@example.com"]));

    const invited = await store.markLaunchInvited("alpha@example.com");
    expect(invited?.launchInvitedAt).toBeTruthy();
    expect((await store.markLaunchInvited("missing@example.com"))).toBeNull();

    const converted = await store.markConverted("beta@example.com");
    expect(converted?.convertedAt).toBeTruthy();

    const refreshed = await store.list({ q: "alpha" });
    expect(refreshed[0]?.launchInvitedAt).toBeTruthy();
    expect(refreshed[0]?.convertedAt).toBeNull();
  });
});

describe("createWaitlistStore", () => {
  const previousCi = process.env.CI;
  afterEach(() => {
    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
  });

  it("uses the in-memory store on CI so the public form does not need Postgres", () => {
    process.env.CI = "true";
    expect(createWaitlistStore()).toBeInstanceOf(MemoryWaitlistStore);
  });

  it("paints a human empty state when the waitlist cannot save", () => {
    const copy = waitlistUnavailableCopy();
    expect(copy.title).toMatch(/isn't taking names/i);
    expect(copy.body).toMatch(/email/i);
    expect(`${copy.title} ${copy.body}`).not.toMatch(/Setup required|setup_required|DATABASE_/i);
    const error = new WaitlistUnavailableError();
    expect(error.status).toBe("setup_required");
    expect(error.message).toBe(copy.body);
  });
});
