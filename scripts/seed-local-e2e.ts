/**
 * Seed a scratch test/ci database with the Playwright owner account so a
 * signed-in `next start` walk can mint a real Better Auth session.
 *
 * Refuses production hosts and databases whose names do not contain test/ci.
 *
 *   DATABASE_ADMIN_URL=postgres://postgres:...@127.0.0.1:5432/vantage_ci \
 *   PLATFORM_OWNER_EMAIL=e2e-owner@vantage.local \
 *   PLATFORM_OWNER_PASSWORD='LocalE2EPassword123!' \
 *   npx tsx scripts/seed-local-e2e.ts
 */
import { Client } from "pg";
import { bootstrapPlatformOwner } from "../packages/core/src/bootstrap-owner.ts";

const ADMIN = process.env.DATABASE_ADMIN_URL;
if (!ADMIN) {
  console.error("Set DATABASE_ADMIN_URL to a local test/ci database.");
  process.exit(2);
}

const url = new URL(ADMIN);
const database = decodeURIComponent(url.pathname.slice(1));
const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
if (process.env.NODE_ENV === "production" || !localHost || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(database)) {
  console.error("DATABASE_ADMIN_URL must be a local database whose name contains test/ci.");
  process.exit(2);
}

const email = (process.env.PLATFORM_OWNER_EMAIL ?? "e2e-owner@vantage.local").trim().toLowerCase();
const password = process.env.PLATFORM_OWNER_PASSWORD ?? "LocalE2EPassword123!";

async function main() {
  const su = new Client(ADMIN);
  await su.connect();
  try {
    const boot = await bootstrapPlatformOwner({
      email,
      password,
      name: process.env.PLATFORM_OWNER_NAME ?? "E2E Owner",
    });
    const user = await su.query<{ id: string }>(`SELECT id FROM users WHERE lower(email)=lower($1)`, [email]);
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error("bootstrap did not create the owner user");
    await su.query(
      `INSERT INTO profiles(user_id, display_name, theme_preference, onboarding_current_step, onboarding_completed_at, terms_accepted_at, terms_version)
       VALUES ($1, $2, 'light', 'complete', now(), now(), 'local-e2e')
       ON CONFLICT (user_id) DO UPDATE
          SET onboarding_completed_at = COALESCE(profiles.onboarding_completed_at, now()),
              onboarding_current_step = 'complete',
              terms_accepted_at = COALESCE(profiles.terms_accepted_at, now())`,
      [userId, boot.email],
    );
    let org = await su.query<{ id: string }>(`SELECT id FROM organizations WHERE slug = 'e2e-team'`);
    if (!org.rowCount) {
      org = await su.query<{ id: string }>(
        `INSERT INTO organizations(name, slug, team_number)
         VALUES ('E2E Team', 'e2e-team', 6925)
         RETURNING id`,
      );
    }
    const orgId = org.rows[0]!.id;
    await su.query(
      `INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [orgId, userId],
    );
    // Local-only venue so Home weather can geocode Houston on event day.
    // Not a TBA event — never poll, never copy this key into production.
    const eventKey = "2026e2ewx";
    await su.query(
      `INSERT INTO events_ref(event_key, year, name, start_date, end_date, city, state_prov, country)
       VALUES ($1, 2026, 'E2E Houston venue', CURRENT_DATE, CURRENT_DATE, 'Houston', 'TX', 'USA')
       ON CONFLICT (event_key) DO UPDATE
          SET start_date = EXCLUDED.start_date,
              end_date = EXCLUDED.end_date,
              city = EXCLUDED.city,
              state_prov = EXCLUDED.state_prov,
              country = EXCLUDED.country,
              name = EXCLUDED.name`,
      [eventKey],
    );
    await su.query(
      `INSERT INTO org_active_context(org_id, active_event_key, set_by_user_id)
       VALUES ($1::uuid, $2, $3::uuid)
       ON CONFLICT (org_id) DO UPDATE
          SET active_event_key = EXCLUDED.active_event_key,
              set_by_user_id = EXCLUDED.set_by_user_id,
              set_at = now()`,
      [orgId, eventKey, userId],
    );
    console.log(
      JSON.stringify({
        ok: true,
        email: boot.email,
        createdUser: boot.createdUser,
        grantedPlatformAdmin: boot.grantedPlatformAdmin,
        orgId,
        eventKey,
        next: "Sign in at /signin with PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD",
      }),
    );
  } finally {
    await su.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Seed failed");
  process.exitCode = 1;
});

