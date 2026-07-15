import { Pool, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://vantage:local@localhost:5432/vantage";

export const requestPool = new Pool({ connectionString });
export const db = drizzle(requestPool, { schema });

export type RequestContext = {
  userId: string;
  orgId?: string;
};

/**
 * The only request-path transaction entry point. SET LOCAL ensures pooled
 * connections cannot leak identity between requests.
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
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export * from "./schema";
