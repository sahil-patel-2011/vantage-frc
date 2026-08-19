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

export * from "./schema";
export * from "./postgres-url";
