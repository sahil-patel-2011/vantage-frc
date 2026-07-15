import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const adminConnection =
  process.env.DATABASE_ADMIN_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL ??
  "postgresql://vantage_admin:local@localhost:5432/vantage";

if (
  process.env.NODE_ENV === "production" &&
  !process.env.DATABASE_ADMIN_URL &&
  !process.env.DATABASE_URL_UNPOOLED &&
  !process.env.DATABASE_URL
) {
  throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for workers in production");
}

const adminPool = new Pool({
  connectionString: adminConnection,
});

/** Worker-only connection. ESLint prevents this import from app request paths. */
export const dbAdmin = drizzle(adminPool, { schema });
