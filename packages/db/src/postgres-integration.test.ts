import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const describeWithDatabase = TEST_DATABASE_ADMIN_URL ? describe.sequential : describe.skip;

if (!TEST_DATABASE_ADMIN_URL) {
  console.info("Skipping real Postgres integration: TEST_DATABASE_ADMIN_URL is not set.");
}

function assertSafeTestDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.slice(1));
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  if (process.env.NODE_ENV === "production" || !localHost || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(database)) {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL must target a local dedicated database whose name contains a test/ci segment",
    );
  }
}

function runMigrations(connectionString: string): string {
  return execFileSync(process.execPath, ["scripts/run-migrations.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: connectionString,
      DATABASE_URL_UNPOOLED: "",
      POSTGRES_URL_NON_POOLING: "",
      DATABASE_URL: "",
      POSTGRES_URL: "",
    },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function visibleOrganizations(client: PoolClient, role: "vantage_app" | "vantage_worker", userId?: string) {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    if (userId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    }
    const result = await client.query<{ id: string }>("SELECT id::text FROM organizations ORDER BY id");
    return result.rows.map((row) => row.id);
  } finally {
    await client.query("ROLLBACK");
  }
}

describeWithDatabase(
  "real Postgres migrations and RLS (set TEST_DATABASE_ADMIN_URL to run locally)",
  () => {
    let pool: Pool;
    let migrationCount = 0;

    beforeAll(async () => {
      assertSafeTestDatabase(TEST_DATABASE_ADMIN_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_ADMIN_URL, max: 1, ssl: false });
      await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
      await pool.query("CREATE SCHEMA public");
      await pool.query("GRANT ALL ON SCHEMA public TO public");
    }, 300_000);

    afterAll(async () => {
      await pool?.end();
    });

    it(
      "applies every migration to a fresh schema and cleanly reapplies",
      async () => {
        const firstRun = runMigrations(TEST_DATABASE_ADMIN_URL!);
        expect(firstRun).toContain("APPLY 0000_foundation.sql");
        expect(firstRun).toContain("OK 0496_org_llm_byok_endpoint.sql");

        const countResult = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM schema_migrations",
        );
        migrationCount = Number(countResult.rows[0]?.count);
        expect(migrationCount).toBeGreaterThan(300);

        const secondRun = runMigrations(TEST_DATABASE_ADMIN_URL!);
        expect(secondRun).not.toContain("APPLY ");
        expect((secondRun.match(/^SKIP /gm) ?? []).length).toBe(migrationCount);

        const reappliedCount = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM schema_migrations",
        );
        expect(Number(reappliedCount.rows[0]?.count)).toBe(migrationCount);
      },
      300_000,
    );

    it("isolates two organizations for vantage_app while vantage_worker sees both", async () => {
      const userOne = "00000000-0000-4000-8000-000000000001";
      const userTwo = "00000000-0000-4000-8000-000000000002";
      const orgOne = "10000000-0000-4000-8000-000000000001";
      const orgTwo = "10000000-0000-4000-8000-000000000002";

      await pool.query(
        `INSERT INTO users (id, email, name)
         VALUES ($1::uuid, 'rls-one@example.test', 'RLS One'),
                ($2::uuid, 'rls-two@example.test', 'RLS Two')`,
        [userOne, userTwo],
      );
      await pool.query(
        `INSERT INTO organizations (id, name, slug, team_number)
         VALUES ($1::uuid, 'RLS Org One', 'rls-org-one', 9001),
                ($2::uuid, 'RLS Org Two', 'rls-org-two', 9002)`,
        [orgOne, orgTwo],
      );
      await pool.query(
        `INSERT INTO memberships (org_id, user_id, role)
         VALUES ($1::uuid, $2::uuid, 'owner'),
                ($3::uuid, $4::uuid, 'owner')`,
        [orgOne, userOne, orgTwo, userTwo],
      );

      const client = await pool.connect();
      try {
        expect(await visibleOrganizations(client, "vantage_app", userOne)).toEqual([orgOne]);
        expect(await visibleOrganizations(client, "vantage_app", userTwo)).toEqual([orgTwo]);
        expect(await visibleOrganizations(client, "vantage_worker")).toEqual([orgOne, orgTwo]);
      } finally {
        client.release();
      }
    });
  },
);
