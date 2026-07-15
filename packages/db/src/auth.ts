import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const authPool = new Pool({
  connectionString:
    process.env.DATABASE_AUTH_URL ??
    process.env.DATABASE_URL ??
    "postgresql://vantage_auth:local@localhost:5432/vantage",
});

/** Least-privilege identity store; it cannot access organizations or billing. */
export const authDb = drizzle(authPool, { schema });
