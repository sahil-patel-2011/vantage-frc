import type { PoolClient } from "@neondatabase/serverless";
import { createDrizzle } from "./drizzle-client";
import { resolveAppDatabaseUrl } from "./postgres-url";

const connectionString = resolveAppDatabaseUrl();

const { pool, db: drizzleDb } = createDrizzle(connectionString);
export const requestPool = pool;
export const db = drizzleDb;

export type RequestContext = {
  userId: string;
  orgId?: string;
};

/** Commits an intentional audit/denial row, then surfaces the public error. */
export class CommitAndThrowError extends Error {
  constructor(readonly publicError: Error) {
    super(publicError.message);
    this.name = "CommitAndThrowError";
  }
}

/**
 * The only request-path transaction entry point. SET LOCAL ensures pooled
 * connections cannot leak identity between requests — including across teams.
 */
export async function withRls<T>(
  context: RequestContext,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await requestPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [context.userId]);
    await client.query("SELECT set_config('app.org_id', $1, true)", [context.orgId ?? ""]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (error instanceof CommitAndThrowError) {
      await client.query("COMMIT");
      throw error.publicError;
    }
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

let savepointSeq = 0;

/**
 * Run a best-effort read or write so that a failure costs only that statement.
 *
 * `withRls` puts the whole request in one transaction, so a `try { … } catch {}`
 * around an optional query is a trap: Postgres marks the transaction aborted and
 * every later statement in the same request fails with "current transaction is
 * aborted", silently emptying features that had nothing to do with the failure.
 * Wrap the optional work in a savepoint instead — on failure only it rolls back
 * and the caller gets `fallback`.
 *
 * Statements on one PoolClient are serialized by the driver, so do not call this
 * concurrently on the same client: releasing an outer savepoint also releases any
 * savepoint opened after it.
 */
export async function withSavepoint<T>(
  client: PoolClient,
  work: () => Promise<T>,
  fallback: T,
): Promise<T> {
  savepointSeq += 1;
  const name = `vantage_sp_${savepointSeq % 1_000_000}`;
  try {
    await client.query(`SAVEPOINT ${name}`);
  } catch {
    // Not inside a usable transaction; fall back to a plain guard.
    try {
      return await work();
    } catch {
      return fallback;
    }
  }
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
    } catch {
      // Connection is unusable; withRls will roll the request back.
    }
    return fallback;
  }
}

export * from "./schema";
export * from "./postgres-url";
