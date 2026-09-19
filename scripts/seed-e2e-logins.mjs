#!/usr/bin/env node
/**
 * Give the browser suite accounts it can actually sign into.
 *
 * `tests/browser/session.ts` signs in with email + password. `seed-dev.mjs`
 * creates its people through the email-code flow and writes no password
 * credential, so even a fully seeded database leaves every signed-in spec
 * unable to authenticate — which is why CI's Playwright job fails wholesale
 * rather than in some interesting way.
 *
 * This writes the missing half: a Better Auth `credential` account row, hashed
 * by Better Auth's own hasher rather than a guess at its format, plus the
 * profile and membership rows the product needs before a page will render
 * (an incomplete profile is redirected to /onboarding by proxy.ts, and a user
 * with no membership has no team to look at).
 *
 * SAFETY: this creates accounts whose passwords are published in the test
 * source. It refuses to run against anything that is not plainly a local or
 * CI scratch database. There is no flag to override that.
 *
 * Usage:
 *   DATABASE_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5432/vantage_e2e \
 *   node scripts/seed-e2e-logins.mjs
 */
import { Client } from "pg";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const ORG_ID = "6925a000-0000-4000-8000-000000000001";

/** Mirrors `fixtureAccount` in tests/browser/session.ts. */
const ACCOUNTS = [
  {
    env: "VANTAGE_E2E_OWNER",
    email: process.env.VANTAGE_E2E_OWNER_EMAIL ?? "e2e-owner@vantage.local",
    password: process.env.VANTAGE_E2E_OWNER_PASSWORD ?? "LocalE2EPassword123!",
    name: "E2E Owner",
    role: "owner",
    id: "6925e2e0-0000-4000-8000-000000000001",
  },
  {
    env: "VANTAGE_E2E_MEMBER",
    email: process.env.VANTAGE_E2E_MEMBER_EMAIL ?? "e2e-member@vantage.local",
    password: process.env.VANTAGE_E2E_MEMBER_PASSWORD ?? "LocalE2EPassword123!",
    name: "E2E Member",
    role: "scout",
    id: "6925e2e0-0000-4000-8000-000000000002",
  },
  {
    /**
     * Signed in, but on no team yet — a real state, and one the suite could
     * not reach before. It is what an invited member sees between accepting
     * and claiming a workspace, and it is the only way to test the
     * "Choose your team" shells without signing out entirely.
     */
    env: "VANTAGE_E2E_NOTEAM",
    email: process.env.VANTAGE_E2E_NOTEAM_EMAIL ?? "e2e-no-team@vantage.local",
    password: process.env.VANTAGE_E2E_NOTEAM_PASSWORD ?? "LocalE2EPassword123!",
    name: "E2E Newcomer",
    role: null,
    id: "6925e2e0-0000-4000-8000-000000000003",
  },
  {
    /**
     * A platform admin — the person who provisions teams, works the waitlist
     * and decides when public sign-up opens.
     *
     * Every /admin surface requires a `platform_admins` row, and no fixture
     * had one, so the whole console was untestable: a walkthrough signed in as
     * an owner simply saw nothing there and could not tell "this is broken"
     * from "you are not allowed to see this". This account is an owner of the
     * same team as well, so it can also check that the admin console and the
     * product do not leak into each other.
     */
    env: "VANTAGE_E2E_PLATFORM",
    email: process.env.VANTAGE_E2E_PLATFORM_EMAIL ?? "e2e-platform@vantage.local",
    password: process.env.VANTAGE_E2E_PLATFORM_PASSWORD ?? "LocalE2EPassword123!",
    name: "E2E Platform Admin",
    role: "owner",
    platformAdmin: true,
    id: "6925e2e0-0000-4000-8000-000000000004",
  },
];

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("Set DATABASE_ADMIN_URL to the scratch database to seed.");
  process.exit(2);
}

/**
 * A known password on an owner account is a back door. Allow only a database
 * that is obviously disposable: a loopback host, or a CI runner.
 */
function isDisposableTarget(raw) {
  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") return true;
  try {
    const parsed = new URL(raw);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

if (!isDisposableTarget(url)) {
  console.error(
    "Refusing to run: DATABASE_ADMIN_URL is not a loopback host and this is not CI.\n" +
      "This script creates accounts whose passwords are published in the test source.",
  );
  process.exit(2);
}

// Better Auth is a dependency of apps/web, not of the repo root.
const require = createRequire(pathToFileURL(join(process.cwd(), "apps/web/package.json")));
const cryptoPath = require.resolve("better-auth/crypto");
const { hashPassword } = await import(pathToFileURL(cryptoPath).href);

const db = new Client({ connectionString: url });
await db.connect();

try {
  await db.query("BEGIN");

  const org = await db.query(`SELECT id FROM organizations WHERE id = $1::uuid`, [ORG_ID]);
  if (org.rowCount === 0) {
    throw new Error(`No seeded organization ${ORG_ID}. Run scripts/seed-dev.mjs first.`);
  }

  /**
   * Let this team sign in with a password.
   *
   * `DEFAULT_ORG_AUTH_POLICY` disallows it — correct for a real team, and the
   * trigger on `organizations` applies that default to every new org
   * including this one. The fixtures sign in with a password because that is
   * the only method a script can drive, so every data-backed page answered
   * 403 "This team does not allow the way you signed in" and the whole suite
   * measured the re-authentication wall instead of the product. Signed-in
   * specs were green while testing nothing.
   *
   * Scoped to this seeded org, in a database whose name must contain "test"
   * or "ci" for the suite to run at all.
   */
  await db.query(
    `INSERT INTO org_auth_policies (org_id, allow_password)
     VALUES ($1::uuid, true)
     ON CONFLICT (org_id) DO UPDATE SET allow_password = true, updated_at = now()`,
    [ORG_ID],
  );

  for (const account of ACCOUNTS) {
    await db.query(
      `INSERT INTO users (id, email, name, email_verified)
       VALUES ($1::uuid, $2, $3, true)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
      [account.id, account.email, account.name],
    );

    // proxy.ts sends an incomplete profile to /onboarding, so every spec would
    // land there instead of on the page it asked for.
    await db.query(
      `INSERT INTO profiles (user_id, display_name, first_name, last_name,
         preferred_team_number, onboarding_completed_at, onboarding_current_step,
         terms_accepted_at, privacy_accepted_at)
       VALUES ($1::uuid, $2, $3, 'Tester', 6925, now(), 'complete', now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         onboarding_completed_at = now(),
         onboarding_current_step = 'complete',
         terms_accepted_at = now(),
         privacy_accepted_at = now()`,
      [account.id, account.name, account.name.split(" ")[0]],
    );

    if (account.role) {
      await db.query(
        `INSERT INTO memberships (org_id, user_id, role)
         VALUES ($1::uuid, $2::uuid, $3::org_role)
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [ORG_ID, account.id, account.role],
      );
    } else {
      // Re-running must not leave a stale membership on the no-team account.
      await db.query(`DELETE FROM memberships WHERE user_id = $1::uuid`, [account.id]);
    }

    // Platform admin is granted, never inherited from a team role: an owner of
    // a team must not be able to reach the console that provisions teams.
    if (account.platformAdmin) {
      await db.query(
        `INSERT INTO platform_admins (user_id) VALUES ($1::uuid)
         ON CONFLICT (user_id) DO NOTHING`,
        [account.id],
      );
    } else {
      await db.query(`DELETE FROM platform_admins WHERE user_id = $1::uuid`, [account.id]);
    }

    const hashed = await hashPassword(account.password);
    await db.query(
      `INSERT INTO accounts (account_id, provider_id, user_id, password)
       VALUES ($1, 'credential', $2::uuid, $3)
       ON CONFLICT (provider_id, account_id) DO UPDATE SET password = EXCLUDED.password`,
      [account.id, account.id, hashed],
    );

    const label = account.platformAdmin ? "admin" : (account.role ?? "no team");
    console.log(`  ${label.padEnd(7)} ${account.email}`);
  }

  await db.query("COMMIT");
  console.log(`\nSeeded ${ACCOUNTS.length} browser-test logins into org ${ORG_ID}.`);
} catch (error) {
  await db.query("ROLLBACK");
  console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
