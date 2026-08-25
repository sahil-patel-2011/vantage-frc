import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv, resolveAppDatabaseUrl } from "@vantage/db/postgres-url";

/**
 * Pairing-role pool for the AI subscription bridge (mirrors @vantage/db/cad-relay).
 * Bridge job enqueue/poll MUST NOT ride the request's withRls transaction: an
 * uncommitted insert would be invisible to the device's claim function on its own
 * connection, so the web caller would wait on a job no device can see.
 *
 * DATABASE_AI_BRIDGE_URL (vantage_pairing role) with fallback to the CAD relay's
 * pairing URL — same role, same trust model. Dev falls back to the app URL.
 * Never constructed at module scope: production builds stay credential-free.
 */
let pool: ReturnType<typeof createSqlPool> | undefined;

export function getAiBridgePool() {
  if (!pool) {
    const connectionString = firstConfiguredEnv("DATABASE_AI_BRIDGE_URL", "DATABASE_CAD_RELAY_URL");
    if (!connectionString) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_AI_BRIDGE_URL (or DATABASE_CAD_RELAY_URL) is required");
      }
      return createSqlPool(resolveAppDatabaseUrl());
    }
    pool = createSqlPool(connectionString);
  }
  return pool;
}
