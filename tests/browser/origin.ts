/**
 * Shared origin for Playwright configs and the auth-cookie helper.
 *
 * Specs used to hardcode localhost:3310. A second checkout on :3510 (or
 * 127.0.0.1 vs localhost) silently dropped the fixture cookie and every
 * signed-in walk bounced to /signin. One function, one env override.
 */
export const DEFAULT_PLAYWRIGHT_PORT = 3310;
export const DEFAULT_PLAYWRIGHT_HOST = "127.0.0.1";

export function playwrightOrigin(): string {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    return process.env.PLAYWRIGHT_BASE_URL.replace(/\/$/, "");
  }
  const port = process.env.PLAYWRIGHT_PORT ?? String(DEFAULT_PLAYWRIGHT_PORT);
  return `http://${DEFAULT_PLAYWRIGHT_HOST}:${port}`;
}

export function playwrightPort(): number {
  const fromEnv = Number(process.env.PLAYWRIGHT_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const port = Number(new URL(playwrightOrigin()).port);
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_PLAYWRIGHT_PORT;
  } catch {
    return DEFAULT_PLAYWRIGHT_PORT;
  }
}

export function cookieDomain(origin = playwrightOrigin()): string {
  return new URL(origin).hostname;
}

/**
 * Same login the GitHub Actions RLS job uses. Local Playwright may fill these
 * in when the shell has no DATABASE_* so `next dev` talks to vantage_ci.
 * GitHub Actions browser job leaves DATABASE_* unset on purpose.
 */
export const LOCAL_VANTAGE_CI_APP = "postgresql://vantage_ci_app:app@127.0.0.1:5432/vantage_ci";
export const LOCAL_VANTAGE_CI_ADMIN = "postgresql://postgres:postgres@127.0.0.1:5432/vantage_ci";

const DATABASE_KEYS = ["DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_ADMIN_URL"] as const;

/**
 * Playwright must never inherit a hosted/production DATABASE_*. Local
 * fixture is vantage_ci (or another test/ci database name) on the loopback.
 * GitHub Actions browser job has no DATABASE_* — that is allowed.
 */
export function assertLocalFixtureDatabase(env: NodeJS.Dict<string> = process.env): void {
  for (const key of DATABASE_KEYS) {
    const value = env[key];
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${key} is not a URL; Playwright will not start.`);
    }
    const host = url.hostname;
    const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
    const db = decodeURIComponent(url.pathname.replace(/^\//, "").replace(/\/$/, ""));
    const ciName = /(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(db);
    if (!local || !ciName) {
      throw new Error(
        `Playwright refuses ${key} host=${host} db=${db}. Point it at local vantage_ci on 127.0.0.1.`,
      );
    }
  }
}

/** Env for the Playwright-owned `next dev` child. Never copies production DATABASE_*. */
export function playwrightWebServerEnv(origin: string, port: number): NodeJS.ProcessEnv {
  const trusted = [
    process.env.AUTH_TRUSTED_ORIGINS,
    origin,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]
    .filter(Boolean)
    .join(",");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    E2E_AUTH_FIXTURE: "1",
    PLAYWRIGHT_BASE_URL: origin,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_URL_LOCAL: origin,
    NEXT_PUBLIC_APP_URL: origin,
    NEXT_PUBLIC_SITE_URL: origin,
    AUTH_TRUSTED_ORIGINS: trusted,
  };
  // GitHub Actions browser job has no Postgres. Cursor/local boxes do —
  // fill vantage_ci when DATABASE_* is unset. `CI=true` is not enough:
  // cloud agent shells often set CI without being GHA.
  if (process.env.GITHUB_ACTIONS !== "true") {
    env.DATABASE_URL ??= LOCAL_VANTAGE_CI_APP;
    env.DATABASE_AUTH_URL ??= LOCAL_VANTAGE_CI_APP;
    env.DATABASE_ADMIN_URL ??= LOCAL_VANTAGE_CI_ADMIN;
    env.BETTER_AUTH_SECRET ??= "vantage-local-playwright-auth-secret";
  }
  assertLocalFixtureDatabase(env);
  return env;
}
