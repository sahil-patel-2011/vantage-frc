import { createSqlPool } from "./pool";
import { firstConfiguredEnv, resolveAppDatabaseUrl } from "./postgres-url";

let pool: ReturnType<typeof createSqlPool> | undefined;

export function getAllianceBoardPool() {
  if (!pool) {
    const connectionString = firstConfiguredEnv("DATABASE_ALLIANCE_BOARD_URL");
    if (!connectionString) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_ALLIANCE_BOARD_URL is required");
      }
      return createSqlPool(resolveAppDatabaseUrl());
    }
    pool = createSqlPool(connectionString);
  }
  return pool;
}
