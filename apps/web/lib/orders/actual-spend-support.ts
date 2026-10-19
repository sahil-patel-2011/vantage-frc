// Whether vendor orders and actual spend (0738) exist in this database. The code ships
// ahead of the migration, so every reader asks first and falls back to the approved figure.

import type { PoolClient } from "@neondatabase/serverless";
import { probeSchemaSupport } from "../schema-probe";

// Remembered only once true, so applying the migration takes effect without a redeploy.
let supportedOnce = false;

export async function vendorOrdersSupported(client: PoolClient): Promise<boolean> {
  if (supportedOnce) return true;
  const supported = await probeSchemaSupport(
    client,
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'vendor_orders' AND column_name = 'total_usd')
          OR (table_name = 'purchase_requests' AND column_name = 'actual_cost_usd'))
     HAVING count(*) = 2`,
  );
  if (supported) supportedOnce = true;
  return supported === true;
}
