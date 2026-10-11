import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
let pool: ReturnType<typeof createSqlPool> | undefined;
export function provisioningPool() {
  if (!pool) {
    // `||`, not `??`: firstConfiguredEnv answers "" when unset, so the development fallback to
    // the admin URL never applied and local setup always failed with "not configured".
    const url = firstConfiguredEnv("DATABASE_WORKER_URL")
      || (process.env.NODE_ENV !== "production" ? firstConfiguredEnv("DATABASE_ADMIN_URL") : "");
    if (!url || url.includes("[SENSITIVE]")) throw new Error("Background database access is not configured.");
    pool = createSqlPool(url, { max: 2 });
  }
  return pool;
}
