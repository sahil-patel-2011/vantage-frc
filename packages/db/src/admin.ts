import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_ADMIN_URL && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_ADMIN_URL is required for workers in production");
}

const adminPool = new Pool({
  connectionString:
    process.env.DATABASE_ADMIN_URL ?? "postgresql://vantage_admin:local@localhost:5432/vantage"
});

/** Worker-only connection. ESLint prevents this import from app request paths. */
export const dbAdmin = drizzle(adminPool, { schema });
