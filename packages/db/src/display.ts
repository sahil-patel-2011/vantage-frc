import { Pool } from "@neondatabase/serverless";

let pool: Pool | undefined;
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
  pool ??= new Pool({ connectionString });
  return pool;
}
