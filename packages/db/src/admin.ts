import { createDrizzle } from "./drizzle-client";
import { firstConfiguredEnv, resolveAdminDatabaseUrl } from "./postgres-url";

const adminConnection = resolveAdminDatabaseUrl();

if (
  process.env.NODE_ENV === "production" &&
  !firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  )
) {
  throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for workers in production");
}

const { db } = createDrizzle(adminConnection);

/** Worker-only connection. ESLint prevents this import from app request paths. */
export const dbAdmin = db;
