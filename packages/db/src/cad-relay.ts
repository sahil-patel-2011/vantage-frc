import { createSqlPool } from "./pool";

let pool: ReturnType<typeof createSqlPool> | undefined;
export function getCadRelayPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_CAD_RELAY_URL;
    if (!connectionString) {
      if (process.env.NODE_ENV === "production") throw new Error("DATABASE_CAD_RELAY_URL is required");
      return createSqlPool(process.env.DATABASE_URL ?? "postgresql://vantage:local@localhost:5432/vantage");
    }
    pool = createSqlPool(connectionString);
  }
  return pool;
}
