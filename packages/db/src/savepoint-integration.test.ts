/**
 * The savepoint contract, against a real Postgres.
 *
 * Unit tests can pin the statement sequence with a fake client, but the whole
 * point of `withSavepoint` is a Postgres behaviour — a failed statement puts the
 * transaction in an aborted state, and `RELEASE` of a savepoint that a sibling
 * already destroyed *also* aborts it. Those two facts are what make the plain
 * `try { … } catch {}` around an optional query destructive, and neither is
 * observable against a stub.
 *
 * Set TEST_DATABASE_ADMIN_URL to a local database whose name contains a
 * test/ci segment to run these; they skip otherwise, like the RLS suite.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSavepoint, withSavepointOrThrow } from "./savepoint";

const TEST_DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const describeWithDatabase = TEST_DATABASE_ADMIN_URL ? describe.sequential : describe.skip;

function assertSafeTestDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.slice(1));
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    process.env.NODE_ENV === "production" ||
    !localHost ||
    !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(database)
  ) {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL must target a local dedicated database whose name contains a test/ci segment",
    );
  }
}

async function transactionIsUsable(client: PoolClient): Promise<boolean> {
  try {
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

describeWithDatabase("withSavepoint against real Postgres", () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    assertSafeTestDatabase(TEST_DATABASE_ADMIN_URL!);
    // max 2: one connection is held for the whole suite as the transaction under
    // test, so pool.query() needs a second or every assertion deadlocks on the pool.
    pool = new Pool({ connectionString: TEST_DATABASE_ADMIN_URL, max: 2, ssl: false });
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT ALL ON SCHEMA public TO public");
    execFileSync(process.execPath, ["scripts/run-migrations.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_ADMIN_URL: TEST_DATABASE_ADMIN_URL!,
        DATABASE_URL_UNPOOLED: "",
        POSTGRES_URL_NON_POOLING: "",
        DATABASE_URL: "",
        POSTGRES_URL: "",
      },
      maxBuffer: 4 * 1024 * 1024,
    });
  }, 600_000);

  beforeAll(async () => {
    client = await pool.connect();
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** The premise. Without this, none of the rest of the work is warranted. */
  it("confirms a swallowed statement error aborts the whole transaction", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT * FROM a_table_that_does_not_exist");
    } catch {
      // exactly the bare catch the codebase was full of
    }
    expect(await transactionIsUsable(client)).toBe(false);
    await client.query("ROLLBACK");
  });

  it("returns the fallback and leaves later statements able to run", async () => {
    await client.query("BEGIN");
    const value = await withSavepoint<unknown>(
      client,
      () => client.query("SELECT * FROM a_table_that_does_not_exist"),
      "fell-back",
    );
    expect(value).toBe("fell-back");
    expect(await transactionIsUsable(client)).toBe(true);
    await client.query("ROLLBACK");
  });

  /**
   * The regression this was written for. Interleaving savepoints by hand gives
   * `savepoint "sp_b" does not exist`, and that error aborts the transaction —
   * so an unserialized withSavepoint inside a `Promise.all` would cause the very
   * failure it exists to prevent. This proves both halves.
   */
  it("aborts the transaction when savepoints interleave by hand", async () => {
    await client.query("BEGIN");
    const settled = await Promise.allSettled([
      (async () => {
        await client.query("SAVEPOINT sp_a");
        await client.query("SELECT pg_sleep(0.02)");
        await client.query("RELEASE SAVEPOINT sp_a");
      })(),
      (async () => {
        await client.query("SAVEPOINT sp_b");
        await client.query("SELECT pg_sleep(0.02)");
        await client.query("RELEASE SAVEPOINT sp_b");
      })(),
    ]);
    expect(settled.some((outcome) => outcome.status === "rejected")).toBe(true);
    expect(await transactionIsUsable(client)).toBe(false);
    await client.query("ROLLBACK");
  });

  it("serializes concurrent calls so Promise.all over one client is safe", async () => {
    await client.query("BEGIN");
    const [first, second, third] = await Promise.all([
      withSavepoint(client, () => client.query<{ v: number }>("SELECT 1 AS v"), null),
      withSavepoint<unknown>(client, () => client.query("SELECT * FROM nope_one"), "second-fallback"),
      withSavepoint(client, () => client.query<{ v: number }>("SELECT 3 AS v"), null),
    ]);
    expect(first?.rows[0]?.v).toBe(1);
    expect(second).toBe("second-fallback");
    expect(third?.rows[0]?.v).toBe(3);
    expect(await transactionIsUsable(client)).toBe(true);
    await client.query("ROLLBACK");
  });

  it("keeps a write issued after a savepointed failure through COMMIT", async () => {
    await client.query("BEGIN");
    await client.query(
      `CREATE TABLE savepoint_probe (id serial PRIMARY KEY, label text NOT NULL)`,
    );
    await client.query("COMMIT");

    await client.query("BEGIN");
    await withSavepoint(client, () => client.query("SELECT * FROM nope_two"), null);
    await client.query(`INSERT INTO savepoint_probe (label) VALUES ('after-failure')`);
    await client.query("COMMIT");

    const kept = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM savepoint_probe WHERE label = 'after-failure'`,
    );
    expect(Number(kept.rows[0]?.count)).toBe(1);
  });

  /**
   * The per-item loop shape: tolerate one class of error, rethrow the rest.
   * Written as a plain try/catch the tolerated error leaves the transaction
   * aborted, so the next item fails with 25P02, the classifier does not
   * recognise it, and the rethrow discards everything already written.
   */
  it("lets a classifying loop tolerate one item and keep the rest", async () => {
    await client.query("BEGIN");
    await client.query(`CREATE TABLE loop_probe (label text PRIMARY KEY)`);
    await client.query("COMMIT");

    await client.query("BEGIN");
    const labels = ["one", "two", "two", "three"];
    const rejected: string[] = [];
    for (const label of labels) {
      try {
        await withSavepointOrThrow(client, () =>
          client.query(`INSERT INTO loop_probe (label) VALUES ($1)`, [label]),
        );
      } catch (error) {
        // A duplicate is the tolerated class; anything else must still surface.
        if ((error as { code?: string }).code !== "23505") throw error;
        rejected.push(label);
      }
    }
    await client.query("COMMIT");

    expect(rejected).toEqual(["two"]);
    const kept = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM loop_probe`);
    expect(Number(kept.rows[0]?.count)).toBe(3);
  });

  /**
   * Migration 0520. `category` said what a part is and `is_spare` now says
   * whether it is held as a replacement, so a spare gearbox can be both — and a
   * consumable can be a spare, which is what lets /spares and /spare-forecast
   * finally share a row.
   */
  it("lets is_spare cross the kind and category axes that category='spare' could not", async () => {
    const orgId = "20000000-0000-4000-8000-000000000001";
    const userId = "20000000-0000-4000-8000-000000000002";
    await pool.query(
      `INSERT INTO users (id, email, name) VALUES ($1::uuid, 'spare@example.test', 'Spare Tester')
       ON CONFLICT (id) DO NOTHING`,
      [userId],
    );
    await pool.query(
      `INSERT INTO organizations (id, name, slug, team_number)
       VALUES ($1::uuid, 'Spare Org', 'spare-org', 9101) ON CONFLICT (id) DO NOTHING`,
      [orgId],
    );
    await pool.query(
      `INSERT INTO inventory_items (org_id, name, category, kind, unit, quantity, min_quantity, is_spare, created_by)
       VALUES ($1::uuid, 'Spare gearbox',   'gearbox',    'part',       'each',  2, 1, true,  $2::uuid),
              ($1::uuid, 'Spare fittings',  'pneumatics', 'consumable', 'each', 20, 5, true,  $2::uuid),
              ($1::uuid, 'Legacy spare bin','spare',      'part',       'each',  3, 1, true,  $2::uuid),
              ($1::uuid, 'Zip ties',        'other',      'consumable', 'each',100,20, false, $2::uuid)`,
      [orgId, userId],
    );

    const legacyPredicate = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_items
        WHERE org_id = $1::uuid AND archived = false AND category = 'spare'`,
      [orgId],
    );
    const currentPredicate = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_items
        WHERE org_id = $1::uuid AND archived = false AND is_spare`,
      [orgId],
    );
    const sharedWithSparesPage = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_items
        WHERE org_id = $1::uuid AND archived = false AND is_spare AND kind = 'consumable'`,
      [orgId],
    );

    expect(Number(legacyPredicate.rows[0]?.count)).toBe(1);
    expect(Number(currentPredicate.rows[0]?.count)).toBe(3);
    // Zero before 0520, by construction: 'spare' is not a consumable category.
    expect(Number(sharedWithSparesPage.rows[0]?.count)).toBe(1);
  });

  it("backfilled every legacy category='spare' row", async () => {
    const backfilled = await pool.query<{ ok: boolean | null }>(
      `SELECT bool_and(is_spare) AS ok FROM inventory_items WHERE category = 'spare'`,
    );
    expect(backfilled.rows[0]?.ok).toBe(true);
  });
});
