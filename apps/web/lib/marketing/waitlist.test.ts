import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("keeps the first person's email when a second person joins", async () => {
    await store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true, email: "a@example.com", teamNumber: 6925 }));
    await store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true, email: "b@example.com", teamNumber: 6925 }));
    const emails = (await store.list()).map((entry) => entry.email).sort();
    expect(emails).toEqual(["a@example.com", "b@example.com"]);
  });

  it("keeps the first answers for an address, without disclosing a duplicate (QA A1-07)", async () => {
    await store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true, email: "a@example.com", teamNumber: 1,
      phone: "+12025550100", smsConsent: true }));
    const first = store.get("a@example.com")!;
    const firstUpdated = first.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 2));
    // Someone else types the same address: they cannot change the team, the phone or the consent.
    await expect(store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true,
      email: "A@example.com",
      teamNumber: 999,
      phone: "+12025550123",
      smsConsent: true,
    }))).resolves.toBeUndefined();
    const kept = store.get("a@example.com")!;
    expect(kept.teamNumber).toBe(1);
    expect(kept.phone).toBe("+12025550100");
    await store.upsert(waitlistSchema.parse({ termsAccepted: true, privacyAccepted: true, email: "a@example.com", teamNumber: 2 }));
    expect(store.get("a@example.com")?.phone).toBe("+12025550100");
    expect(store.get("a@example.com")?.smsConsent).toBe(true);
    // The renewed interest is still noted.
    expect(store.get("a@example.com")!.updatedAt.getTime()).toBeGreaterThan(firstUpdated.getTime());
  });

  it("does the same in Postgres: a conflict only touches updated_at", () => {
    const source = readFileSync(join(__dirname, "waitlist.ts"), "utf8");
    const conflict = /ON CONFLICT \(email_normalized\) DO UPDATE SET([^`]*)`/.exec(source)?.[1] ?? "";
    expect(conflict.trim()).toBe("updated_at = now()");
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
  const previousFixture = process.env.E2E_AUTH_FIXTURE;
  afterEach(() => {
    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
    if (previousFixture === undefined) delete process.env.E2E_AUTH_FIXTURE;
    else process.env.E2E_AUTH_FIXTURE = previousFixture;
  });

  it("uses the in-memory store on CI so the public form does not need Postgres", () => {
    process.env.CI = "true";
    expect(createWaitlistStore()).toBeInstanceOf(MemoryWaitlistStore);
  });

  it("uses the in-memory store under the Playwright auth fixture", () => {
    delete process.env.CI;
    process.env.E2E_AUTH_FIXTURE = "1";
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

describe("waitlist messages a visitor can read", () => {
  it("says what a team number is instead of the validator's words", () => {
    const parsed = waitlistSchema.safeParse({ email: "a@b.org", teamNumber: 0, termsAccepted: true, privacyAccepted: true });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Team numbers are digits only, 1 to 99999.");
  });
});
