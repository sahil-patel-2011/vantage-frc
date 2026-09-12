import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertLocalFixtureDatabase,
  LOCAL_VANTAGE_CI_ADMIN,
  LOCAL_VANTAGE_CI_APP,
  playwrightWebServerEnv,
  shouldReuseLiveNextDevLock,
} from "./origin";

const KEYS = [
  "DATABASE_URL",
  "DATABASE_AUTH_URL",
  "DATABASE_ADMIN_URL",
  "CI",
  "GITHUB_ACTIONS",
  "BETTER_AUTH_SECRET",
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

describe("shouldReuseLiveNextDevLock", () => {
  it("reuses a human next only when NEXT_DIST_DIR is .next", () => {
    expect(shouldReuseLiveNextDevLock({})).toBe(false);
    expect(shouldReuseLiveNextDevLock({ NEXT_DIST_DIR: ".next-pw" })).toBe(false);
    expect(shouldReuseLiveNextDevLock({ NEXT_DIST_DIR: ".next" })).toBe(true);
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
    expect(env.MALLOC_ARENA_MAX).toBe("2");
    expect(env.NEXT_DIST_DIR).toBe(".next-pw");
  });

  it("honors an explicit NEXT_DIST_DIR for a leftover next cache", () => {
    const previous = process.env.NEXT_DIST_DIR;
    process.env.NEXT_DIST_DIR = ".next-pw-3598";
    try {
      const env = playwrightWebServerEnv("http://127.0.0.1:3310", 3310);
      expect(env.NEXT_DIST_DIR).toBe(".next-pw-3598");
    } finally {
      if (previous === undefined) delete process.env.NEXT_DIST_DIR;
      else process.env.NEXT_DIST_DIR = previous;
    }
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
    expect(env.MALLOC_ARENA_MAX).toBe("2");
  });

  it("does not stack a second max-old-space-size onto NODE_OPTIONS", () => {
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--max-old-space-size=2048";
    try {
      const env = playwrightWebServerEnv("http://127.0.0.1:3310", 3310);
      expect(env.NODE_OPTIONS).toBe("--max-old-space-size=2048");
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });
});
