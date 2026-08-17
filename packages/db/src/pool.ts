import { Pool as NeonPool } from "@neondatabase/serverless";
import pg from "pg";
import { shouldUseNodePostgres, sslOptionForUrl } from "./postgres-url";

/**
 * Runtime pool may be Neon websocket or node-postgres. Call sites stay typed as
 * Neon `Pool` so `query()` is callable; tenancy is still SET LOCAL in withRls.
 */
export function createRawSqlPool(connectionString: string): NeonPool | pg.Pool {
  if (shouldUseNodePostgres(connectionString)) {
    return new pg.Pool({
      connectionString,
      max: 8,
      ssl: sslOptionForUrl(connectionString),
    });
  }
  return new NeonPool({ connectionString });
}

export function createSqlPool(connectionString: string): NeonPool {
  return createRawSqlPool(connectionString) as unknown as NeonPool;
}
