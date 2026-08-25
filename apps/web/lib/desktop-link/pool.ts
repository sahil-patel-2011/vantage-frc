import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv, resolveAppDatabaseUrl } from "@vantage/db/postgres-url";

/**
 * Pairing-role pool for desktop browser-link traffic (mirrors lib/ai-bridge/pool.ts).
 * Start/poll/exchange arrive with NO session cookie, so they cannot ride a
 * withRls transaction — and the approval happens on a different connection than
 * the desktop's poll, so the flows must see each other's committed rows.
 *
 * DATABASE_DESKTOP_LINK_URL (vantage_pairing role) with fallback to the AI
 * bridge / CAD relay pairing URLs — same role, same trust model. Dev falls back
 * to the app URL. Never constructed at module scope: production builds stay
 * credential-free.
 */
let pool: ReturnType<typeof createSqlPool> | undefined;

export function getDesktopLinkPool() {
  if (!pool) {
    const connectionString = firstConfiguredEnv(
      "DATABASE_DESKTOP_LINK_URL",
      "DATABASE_AI_BRIDGE_URL",
      "DATABASE_CAD_RELAY_URL",
    );
    if (!connectionString) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_DESKTOP_LINK_URL (or DATABASE_AI_BRIDGE_URL / DATABASE_CAD_RELAY_URL) is required");
      }
      return createSqlPool(resolveAppDatabaseUrl());
    }
    pool = createSqlPool(connectionString);
  }
  return pool;
}
