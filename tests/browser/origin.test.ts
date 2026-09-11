import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertLocalFixtureDatabase,
  LOCAL_VANTAGE_CI_ADMIN,
  LOCAL_VANTAGE_CI_APP,
  playwrightOwnedOrigin,
  playwrightOwnedPort,
  playwrightWebServerEnv,
} from "./origin";

const KEYS = [
  "DATABASE_URL",
  "DATABASE_AUTH_URL",
  "DATABASE_ADMIN_URL",
  "CI",
  "GITHUB_ACTIONS",
  "BETTER_AUTH_SECRET",
  "PLAYWRIGHT_BASE_URL",
  "PLAYWRIGHT_PORT",
] as const;

let snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  snapshot = {};
  for (const key of KEYS) snapshot[key] = process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
});

describe("assertLocalFixtureDatabase", () => {
  it("allows a machine with no DATABASE_* (GitHub Actions browser job)", () => {
    expect(() => assertLocalFixtureDatabase({})).not.toThrow();
  });

  it("accepts local vantage_ci on the loopback", () => {
    expect(() =>
      assertLocalFixtureDatabase({
        DATABASE_URL: LOCAL_VANTAGE_CI_APP,
        DATABASE_AUTH_URL: LOCAL_VANTAGE_CI_APP,
        DATABASE_ADMIN_URL: LOCAL_VANTAGE_CI_ADMIN,
      }),
    ).not.toThrow();
  });

  it("refuses a hosted Neon URL", () => {
    expect(() =>
      assertLocalFixtureDatabase({
        DATABASE_URL: "postgresql://app:secret@ep-cool.neon.tech/vantage",
      }),
    ).toThrow(/Playwright refuses DATABASE_URL/);
  });

  it("refuses 127.0.0.1 when the database name is not test/ci", () => {
    expect(() =>
      assertLocalFixtureDatabase({
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/vantage",
      }),
    ).toThrow(/db=vantage/);
  });

  it("refuses a non-URL", () => {
    expect(() => assertLocalFixtureDatabase({ DATABASE_URL: "not-a-url" })).toThrow(/is not a URL/);
  });
});

describe("playwrightWebServerEnv", () => {
  it("fills local vantage_ci when DATABASE_* is unset outside GitHub Actions", () => {
    delete process.env.GITHUB_ACTIONS;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_AUTH_URL;
    delete process.env.DATABASE_ADMIN_URL;
    const env = playwrightWebServerEnv("http://127.0.0.1:3310", 3310);
    expect(env.NODE_ENV).toBe("development");
    expect(env.E2E_AUTH_FIXTURE).toBe("1");
    expect(env.DATABASE_URL).toBe(LOCAL_VANTAGE_CI_APP);
    expect(env.DATABASE_ADMIN_URL).toBe(LOCAL_VANTAGE_CI_ADMIN);
    expect(env.BETTER_AUTH_URL).toBe("http://127.0.0.1:3310");
    expect(env.NODE_OPTIONS).toMatch(/max-old-space-size=4096/);
    expect(env.NODE_OPTIONS).not.toMatch(/8192/);
    expect(env.NEXT_DIST_DIR).toBe(".next-pw-3310");
  });

  it("does not invent DATABASE_* on GitHub Actions", () => {
    process.env.GITHUB_ACTIONS = "true";
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_AUTH_URL;
    delete process.env.DATABASE_ADMIN_URL;
    const env = playwrightWebServerEnv("http://127.0.0.1:3310", 3310);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.E2E_AUTH_FIXTURE).toBe("1");
    expect(env.NODE_ENV).toBe("development");
    expect(env.NODE_OPTIONS).toMatch(/max-old-space-size=4096/);
  });
});

describe("playwrightOwnedOrigin", () => {
  it("ignores leftover PLAYWRIGHT_BASE_URL so the default config can own webServer", () => {
    process.env.PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3560";
    delete process.env.PLAYWRIGHT_PORT;
    expect(playwrightOwnedPort()).toBe(3310);
    expect(playwrightOwnedOrigin()).toBe("http://127.0.0.1:3310");
    process.env.PLAYWRIGHT_PORT = "3588";
    expect(playwrightOwnedPort()).toBe(3588);
    expect(playwrightOwnedOrigin()).toBe("http://127.0.0.1:3588");
  });
});
