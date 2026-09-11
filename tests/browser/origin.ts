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
 * Playwright must never inherit a hosted/production DATABASE_*. Local
 * fixture is vantage_ci (or another *test*/*ci* name) on the loopback.
 * GitHub Actions browser job has no DATABASE_* — that is allowed.
 */
export function assertLocalFixtureDatabase(): void {
  const keys = ["DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_ADMIN_URL"] as const;
  for (const key of keys) {
    const value = process.env[key];
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
