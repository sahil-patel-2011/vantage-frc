import { afterEach, describe, expect, it } from "vitest";
import {
  e2eFixtureEmails,
  isE2eFixtureCookie,
  isLocalCiDatabaseUrl,
  isLocalE2eFixtureRuntime,
  resetE2eFixtureActorCache,
  resolveProductActor,
} from "./product-actor";

afterEach(() => {
  resetE2eFixtureActorCache();
});

describe("product actor", () => {
  it("reads the E2E fixture cookie and ignores Better Auth lookalikes", () => {
    expect(isE2eFixtureCookie("vantage-e2e-session=authenticated")).toBe(true);
    expect(isE2eFixtureCookie("vantage-e2e-session=authenticated; other=1")).toBe(true);
    expect(isE2eFixtureCookie("vantage-e2e-session=nope")).toBe(false);
    expect(isE2eFixtureCookie("better-auth.session_token=abc")).toBe(false);
    expect(isE2eFixtureCookie(null)).toBe(false);
  });

  it("only enables the fixture identity on local non-production runtimes", () => {
    expect(isLocalE2eFixtureRuntime({ NODE_ENV: "development", E2E_AUTH_FIXTURE: "1" })).toBe(true);
    expect(isLocalE2eFixtureRuntime({ NODE_ENV: "production", E2E_AUTH_FIXTURE: "1" })).toBe(false);
    expect(isLocalE2eFixtureRuntime({ NODE_ENV: "development", E2E_AUTH_FIXTURE: "1", VERCEL: "1" })).toBe(
      false,
    );
    expect(isLocalE2eFixtureRuntime({ NODE_ENV: "development" })).toBe(false);
  });

  it("accepts only loopback test/ci database URLs", () => {
    expect(isLocalCiDatabaseUrl("postgresql://vantage_ci_app:app@127.0.0.1:5432/vantage_ci")).toBe(true);
    expect(isLocalCiDatabaseUrl("postgresql://postgres:postgres@localhost:5432/vantage_test")).toBe(true);
    expect(isLocalCiDatabaseUrl("postgresql://app:x@db.neon.tech/vantage_ci")).toBe(false);
    expect(isLocalCiDatabaseUrl("postgresql://app:x@127.0.0.1:5432/vantage")).toBe(false);
  });

  it("prefers the Playwright owner mailbox over the platform-owner default", () => {
    expect(
      e2eFixtureEmails({
        VANTAGE_E2E_OWNER_EMAIL: "e2e-owner@vantage.local",
        PLATFORM_OWNER_EMAIL: "owner@example.com",
      })[0],
    ).toBe("e2e-owner@vantage.local");
  });

  it("uses a Better Auth session without looking up the fixture user", async () => {
    const actor = await resolveProductActor({
      session: { userId: "user-1", email: "ada@example.com", name: "Ada", sessionId: "sess-1" },
      cookieHeader: "vantage-e2e-session=authenticated",
      env: { NODE_ENV: "development", E2E_AUTH_FIXTURE: "1" },
    });
    expect(actor).toEqual({
      userId: "user-1",
      email: "ada@example.com",
      name: "Ada",
      sessionId: "sess-1",
      authMethod: "unknown",
      source: "session",
    });
  });

  it("does not invent a fixture actor in production", async () => {
    await expect(
      resolveProductActor({
        session: null,
        cookieHeader: "vantage-e2e-session=authenticated",
        env: { NODE_ENV: "production", E2E_AUTH_FIXTURE: "1" },
      }),
    ).resolves.toBeNull();
  });
});
