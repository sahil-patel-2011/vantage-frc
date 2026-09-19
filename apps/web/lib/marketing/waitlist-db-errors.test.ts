import { describe, expect, it, vi } from "vitest";
import { NeonWaitlistStore } from "./waitlist";

/**
 * A grant mistake is a configuration mistake, and it used to reach a platform
 * admin as the database's own words — "permission denied for table
 * waitlist_signups" — on a screen that was meant to show a list of people.
 */
describe("what the waitlist store says when the database refuses it", () => {
  function storeThatFailsWith(message: string) {
    const store = new NeonWaitlistStore("postgres://unused/local");
    // The pool is created lazily and memoised in module scope, so the fake
    // goes in at the one seam the store actually calls.
    vi.spyOn(
      store as unknown as { rawPool: () => unknown },
      "rawPool",
    ).mockReturnValue({
      query: () => Promise.reject(new Error(message)),
    });
    return store;
  }

  it("names the variable to fix when the role has no grant", async () => {
    const store = storeThatFailsWith("permission denied for table waitlist_signups");
    await expect(store.list()).rejects.toThrow(/MARKETING_DATABASE_URL/);
    await expect(store.list()).rejects.toThrow(/vantage_marketing/);
  });

  it("says the table is missing when the database is the wrong one", async () => {
    const store = storeThatFailsWith('relation "waitlist_signups" does not exist');
    await expect(store.list()).rejects.toThrow(/migrations|unset the variable/i);
  });

  it("leaves an unrelated failure exactly as it was", async () => {
    // Inventing an explanation for a timeout would be worse than none.
    const store = storeThatFailsWith("connection terminated unexpectedly");
    await expect(store.list()).rejects.toThrow("connection terminated unexpectedly");
  });

  it("translates writes too, not only the admin list", async () => {
    const store = storeThatFailsWith("permission denied for table waitlist_signups");
    await expect(
      store.upsert({ email: "a@b.co", teamNumber: 6925, phone: "", smsConsent: false }),
    ).rejects.toThrow(/MARKETING_DATABASE_URL/);
  });
});
