import { createDrizzle } from "./drizzle-client";

const { db } = createDrizzle(
  process.env.DATABASE_AUTH_URL ??
    process.env.DATABASE_URL ??
    "postgresql://vantage_auth:local@localhost:5432/vantage",
);

/** Least-privilege identity store; it cannot access organizations or billing. */
export const authDb = db;
