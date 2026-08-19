import { createSqlPool } from "./pool";
import { firstConfiguredEnv, resolveBillingDatabaseUrl } from "./postgres-url";

let pool: ReturnType<typeof createSqlPool> | undefined;
export function getBillingPool() {
  const connectionString = resolveBillingDatabaseUrl();
  if (
    process.env.NODE_ENV === "production" &&
    !firstConfiguredEnv("DATABASE_BILLING_URL", "DATABASE_URL", "POSTGRES_URL")
  ) {
    throw new Error("DATABASE_BILLING_URL or DATABASE_URL is required for Stripe webhooks");
  }
  pool ??= createSqlPool(connectionString);
  return pool;
}
