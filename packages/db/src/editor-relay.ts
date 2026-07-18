import { Pool } from "@neondatabase/serverless";

/**
 * Pairing/device-token pool for the VS Code editor connector.
 * Reuses DATABASE_CAD_RELAY_URL (vantage_pairing) when present; falls back to DATABASE_URL locally.
 */
let pool: Pool | undefined;

export function getEditorRelayPool() {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_EDITOR_RELAY_URL ??
      process.env.DATABASE_CAD_RELAY_URL ??
      process.env.DATABASE_URL;
    if (!connectionString) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_EDITOR_RELAY_URL or DATABASE_CAD_RELAY_URL is required");
      }
      return new Pool({
        connectionString: "postgresql://vantage:local@localhost:5432/vantage",
      });
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
