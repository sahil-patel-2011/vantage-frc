import { createSqlPool } from "./pool";

let pool: ReturnType<typeof createSqlPool> | undefined;
export function getDisplayPool() {
  const connectionString =
    process.env.DATABASE_DISPLAY_URL ??
    process.env.DATABASE_URL ??
    "postgresql://vantage_display:local@localhost:5432/vantage";
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.DATABASE_DISPLAY_URL &&
    !process.env.DATABASE_URL
  ) {
    throw new Error("DATABASE_DISPLAY_URL or DATABASE_URL is required for read-only display tokens");
  }
  pool ??= createSqlPool(connectionString);
  return pool;
}
