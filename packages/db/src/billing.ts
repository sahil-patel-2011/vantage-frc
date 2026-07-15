import { Pool } from "@neondatabase/serverless";

let pool: Pool | undefined;
export function getBillingPool() {
  if (!process.env.DATABASE_BILLING_URL && process.env.NODE_ENV === "production")
    throw new Error("DATABASE_BILLING_URL is required for Stripe webhooks");
  pool ??= new Pool({
    connectionString:
      process.env.DATABASE_BILLING_URL ??
      "postgresql://vantage_billing:local@localhost:5432/vantage",
  });
  return pool;
}
