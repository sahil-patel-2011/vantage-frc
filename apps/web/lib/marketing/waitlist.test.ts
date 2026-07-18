import { beforeEach, describe, expect, it } from "vitest";
import { MemoryWaitlistStore, waitlistSchema } from "./waitlist";

describe("waitlist validation", () => {
  it("normalizes valid input", () => {
    const result = waitlistSchema.parse({
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
  ])("rejects malformed or non-consensual input: %#", (input) => {
    expect(waitlistSchema.safeParse(input).success).toBe(false);
  });
});

describe("duplicate-safe persistence", () => {
  const store = new MemoryWaitlistStore();
  beforeEach(() => store.clear());

  it("updates an existing email without disclosing a duplicate", async () => {
    await store.upsert(waitlistSchema.parse({ email: "a@example.com", teamNumber: 1 }));
    await expect(store.upsert(waitlistSchema.parse({
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
    await store.upsert(waitlistSchema.parse({ email: "alpha@example.com", teamNumber: 254 }));
    await store.upsert(waitlistSchema.parse({ email: "beta@example.com", teamNumber: 9999 }));

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
