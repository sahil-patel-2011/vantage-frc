import { createSqlPool } from "./pool";
import { firstConfiguredEnv } from "./postgres-url";

/**
 * Pairing/device-token pool for the VS Code editor connector.
 * Reuses DATABASE_CAD_RELAY_URL (vantage_pairing) when present; falls back to DATABASE_URL locally.
 */
let pool: ReturnType<typeof createSqlPool> | undefined;

export function getEditorRelayPool() {
  if (!pool) {
    const connectionString =
      firstConfiguredEnv("DATABASE_EDITOR_RELAY_URL", "DATABASE_CAD_RELAY_URL", "DATABASE_URL", "POSTGRES_URL");
    if (!connectionString) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_EDITOR_RELAY_URL or DATABASE_CAD_RELAY_URL is required");
      }
      return createSqlPool("postgresql://vantage:local@localhost:5432/vantage");
    }
    pool = createSqlPool(connectionString);
  }
  return pool;
}
