import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
let pool: ReturnType<typeof createSqlPool> | undefined;
export function provisioningPool() {
  if (!pool) {
    const url = firstConfiguredEnv("DATABASE_WORKER_URL")
      ?? (process.env.NODE_ENV !== "production" ? firstConfiguredEnv("DATABASE_ADMIN_URL") : undefined);
    if (!url || url.includes("[SENSITIVE]")) throw new Error("Background database access is not configured.");
    pool = createSqlPool(url, { max: 2 });
  }
  return pool;
}
