import { Pool as NeonPool } from "@neondatabase/serverless";
import pg from "pg";
import {
  assertSafePostgresUrl,
  poolLimitsForUrl,
  shouldUseNodePostgres,
  sslOptionForUrl,
} from "./postgres-url";

export type SqlPoolOptions = {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
};

/**
 * Runtime pool may be Neon websocket or node-postgres. Call sites stay typed as
 * Neon `Pool` so `query()` is callable; tenancy is still SET LOCAL in withRls.
 */
export function createRawSqlPool(
  connectionString: string,
  options?: SqlPoolOptions,
): NeonPool | pg.Pool {
  assertSafePostgresUrl(connectionString);
  const limits = poolLimitsForUrl(connectionString);
  const max = options?.max ?? limits.max;
  const idleTimeoutMillis = options?.idleTimeoutMillis ?? limits.idleTimeoutMillis;
  const connectionTimeoutMillis = options?.connectionTimeoutMillis ?? limits.connectionTimeoutMillis;
  if (shouldUseNodePostgres(connectionString)) {
    return new pg.Pool({
      connectionString,
      max,
      idleTimeoutMillis,
      ...(connectionTimeoutMillis != null ? { connectionTimeoutMillis } : {}),
      ssl: sslOptionForUrl(connectionString),
    });
  }
  return new NeonPool({ connectionString, max, idleTimeoutMillis });
}

export function createSqlPool(connectionString: string, options?: SqlPoolOptions): NeonPool {
  return createRawSqlPool(connectionString, options) as unknown as NeonPool;
}
