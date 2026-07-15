import { Pool } from "@neondatabase/serverless";
let pool: Pool | undefined;
export function getDisplayPool() {
  if (!process.env.DATABASE_DISPLAY_URL && process.env.NODE_ENV === "production")
    throw new Error("DATABASE_DISPLAY_URL is required for read-only display tokens");
  pool ??= new Pool({
    connectionString:
      process.env.DATABASE_DISPLAY_URL ??
      "postgresql://vantage_display:local@localhost:5432/vantage",
  });
  return pool;
}
