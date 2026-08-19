import { createSqlPool } from "./pool";
import { firstConfiguredEnv, resolveDisplayDatabaseUrl } from "./postgres-url";

let pool: ReturnType<typeof createSqlPool> | undefined;
export function getDisplayPool() {
  const connectionString = resolveDisplayDatabaseUrl();
  if (
    process.env.NODE_ENV === "production" &&
    !firstConfiguredEnv("DATABASE_DISPLAY_URL", "DATABASE_URL", "POSTGRES_URL")
  ) {
    throw new Error("DATABASE_DISPLAY_URL or DATABASE_URL is required for read-only display tokens");
  }
  pool ??= createSqlPool(connectionString);
  return pool;
}
