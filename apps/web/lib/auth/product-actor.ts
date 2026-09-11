import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";

export const E2E_FIXTURE_COOKIE_NAME = "vantage-e2e-session";
export const E2E_FIXTURE_COOKIE_VALUE = "authenticated";
export const LOCAL_E2E_OWNER_EMAIL = "e2e-owner@vantage.local";
export const LOCAL_E2E_MEMBER_EMAIL = "e2e-member@vantage.local";

export type ProductActorSource = "session" | "e2e-fixture";

export type ProductActor = {
  userId: string;
  email: string;
  name: string;
  sessionId: string | null;
  authMethod: string;
  source: ProductActorSource;
};

export type SessionActorInput = {
  userId: string;
  email?: string | null;
  name?: string | null;
  sessionId?: string | null;
  authMethod?: string | null;
};

let fixtureLookup: Promise<ProductActor | null> | null = null;

/** Test-only: drop the in-process E2E owner lookup. */
export function resetE2eFixtureActorCache(): void {
  fixtureLookup = null;
}

export function isE2eFixtureCookie(cookieHeader: string | null | undefined): boolean {
  const match = /(?:^|;\s*)vantage-e2e-session=([^;]*)/i.exec(cookieHeader ?? "");
  return decodeURIComponent(match?.[1]?.trim() ?? "") === E2E_FIXTURE_COOKIE_VALUE;
}

export function isLocalE2eFixtureRuntime(env: NodeJS.Dict<string> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.E2E_AUTH_FIXTURE === "1" && env.VERCEL !== "1";
}

/** Loopback test/ci Postgres only — never a hosted production URL. */
export function isLocalCiDatabaseUrl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
    const database = decodeURIComponent(url.pathname.replace(/^\//, "").replace(/\/$/, ""));
    return local && /(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(database);
  } catch {
    return false;
  }
}

export function e2eFixtureEmails(env: NodeJS.Dict<string> = process.env): string[] {
  const out: string[] = [];
  const push = (value?: string) => {
    const email = value?.trim().toLowerCase() ?? "";
    if (email.includes("@") && !out.includes(email)) out.push(email);
  };
  push(env.VANTAGE_E2E_OWNER_EMAIL);
  push(LOCAL_E2E_OWNER_EMAIL);
  push(env.PLATFORM_OWNER_EMAIL);
  push(LOCAL_E2E_MEMBER_EMAIL);
  return out;
}

function sessionActor(session: SessionActorInput): ProductActor {
  const email = session.email?.trim() || "";
  const name = session.name?.trim() || email || "Member";
  return {
    userId: session.userId,
    email,
    name,
    sessionId: session.sessionId?.trim() || null,
    authMethod: session.authMethod?.trim() || "unknown",
    source: "session",
  };
}

function candidateLookupUrls(env: NodeJS.Dict<string> = process.env): string[] {
  const urls: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && isLocalCiDatabaseUrl(trimmed) && !urls.includes(trimmed)) urls.push(trimmed);
  };
  push(firstConfiguredEnv("DATABASE_AUTH_URL", "DATABASE_URL"));
  push(env.DATABASE_ADMIN_URL ?? "");
  return urls;
}

async function lookupFixtureUser(env: NodeJS.Dict<string> = process.env): Promise<ProductActor | null> {
  const emails = e2eFixtureEmails(env);
  if (!emails.length) return null;
  for (const connectionString of candidateLookupUrls(env)) {
    const pool = createSqlPool(connectionString, { max: 1 });
    try {
      for (const email of emails) {
        const found = await pool.query<{ id: string; email: string; name: string | null }>(
          `SELECT id, email, name FROM users WHERE lower(email) = lower($1) LIMIT 1`,
          [email],
        );
        const row = found.rows[0];
        if (!row?.id) continue;
        return {
          userId: row.id,
          email: row.email,
          name: row.name?.trim() || row.email || "Student",
          sessionId: null,
          authMethod: "unknown",
          source: "e2e-fixture",
        };
      }
    } catch {
      // Try the next local CI URL. App-role AUTH URLs are RLS-gated and often
      // return zero rows; the admin URL on vantage_ci can still resolve the seed.
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
  return null;
}

/**
 * Who this request is acting as.
 *
 * Better Auth wins. Under local `E2E_AUTH_FIXTURE=1` the proxy cookie is not a
 * session, so we resolve the seeded vantage_ci owner and run Hours / workspace
 * through `withRls` as that member. Production and hosted runtimes never take
 * this path. Missing seed → null (callers return empty/setup, never invented totals).
 */
export async function resolveProductActor(input: {
  session?: SessionActorInput | null;
  cookieHeader?: string | null;
  env?: NodeJS.Dict<string>;
}): Promise<ProductActor | null> {
  if (input.session?.userId) return sessionActor(input.session);
  const env = input.env ?? process.env;
  if (!isLocalE2eFixtureRuntime(env) || !isE2eFixtureCookie(input.cookieHeader)) return null;
  if (!fixtureLookup) fixtureLookup = lookupFixtureUser(env);
  return fixtureLookup;
}
