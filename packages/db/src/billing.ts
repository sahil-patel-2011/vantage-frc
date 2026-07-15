import { Pool } from "@neondatabase/serverless";

let pool: Pool | undefined;
export function getBillingPool() {
  const connectionString =
    process.env.DATABASE_BILLING_URL ??
    process.env.DATABASE_URL ??
    "postgresql://vantage_billing:local@localhost:5432/vantage";
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.DATABASE_BILLING_URL &&
    !process.env.DATABASE_URL
  ) {
    throw new Error("DATABASE_BILLING_URL or DATABASE_URL is required for Stripe webhooks");
  }
  pool ??= new Pool({ connectionString });
  return pool;
}
