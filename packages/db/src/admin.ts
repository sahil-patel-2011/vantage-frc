import { createDrizzle } from "./drizzle-client";
import { firstConfiguredEnv, resolveAdminDatabaseUrl } from "./postgres-url";

type AdminDb = ReturnType<typeof createDrizzle>["db"];

const ADMIN_URL_ENVS = [
  "DATABASE_ADMIN_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "POSTGRES_URL",
] as const;

function assertProductionAdminUrl() {
  if (process.env.NODE_ENV === "production" && !firstConfiguredEnv(...ADMIN_URL_ENVS)) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for workers in production");
  }
}

let cached: AdminDb | undefined;

function getAdminDb(): AdminDb {
  assertProductionAdminUrl();
  cached ??= createDrizzle(resolveAdminDatabaseUrl()).db;
  return cached;
}

/**
 * Worker-only connection. ESLint prevents this import from app request paths.
 * Initialized on first use so credential-free `next build` can collect page data.
 */
export const dbAdmin: AdminDb = new Proxy({} as AdminDb, {
  get(_target, prop, receiver) {
    const db = getAdminDb();
    const value = Reflect.get(db as object, prop, receiver);
    return typeof value === "function" ? value.bind(db) : value;
  },
});
