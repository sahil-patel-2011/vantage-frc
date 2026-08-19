import { createSqlPool } from "./pool";
import { firstConfiguredEnv, resolveAppDatabaseUrl } from "./postgres-url";

let pool: ReturnType<typeof createSqlPool> | undefined;
export function getCadRelayPool() {
  if (!pool) {
    const connectionString = firstConfiguredEnv("DATABASE_CAD_RELAY_URL");
    if (!connectionString) {
      if (process.env.NODE_ENV === "production") throw new Error("DATABASE_CAD_RELAY_URL is required");
      return createSqlPool(resolveAppDatabaseUrl());
    }
    pool = createSqlPool(connectionString);
  }
  return pool;
}
