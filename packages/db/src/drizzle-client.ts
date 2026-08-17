import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createRawSqlPool } from "./pool";
import { shouldUseNodePostgres } from "./postgres-url";
import * as schema from "./schema";

export function createDrizzle(connectionString: string) {
  const raw = createRawSqlPool(connectionString);
  const pool = raw as unknown as NeonPool;
  if (shouldUseNodePostgres(connectionString)) {
    return { pool, db: drizzlePg(raw as pg.Pool, { schema }) };
  }
  return { pool, db: drizzleNeon(raw as NeonPool, { schema }) };
}
