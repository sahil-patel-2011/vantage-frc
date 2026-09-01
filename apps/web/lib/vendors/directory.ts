import type { PoolClient } from "@neondatabase/serverless";

const VENDOR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DirectoryVendor = {
  id: string;
  name: string;
  preferred: boolean;
};

/** Accept only a real vendor-directory UUID — never a free-text supplier name. */
export function parseVendorId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return VENDOR_ID_RE.test(trimmed) ? trimmed : null;
}

export async function resolveDirectoryVendor(
  client: PoolClient,
  orgId: string,
  vendorId: string,
): Promise<DirectoryVendor | null> {
  const result = await client.query<DirectoryVendor>(
    `SELECT id, name, preferred
     FROM vendors
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [vendorId, orgId],
  );
  return result.rows[0] ?? null;
}

export async function listDirectoryVendors(client: PoolClient, orgId: string): Promise<DirectoryVendor[]> {
  const result = await client.query<DirectoryVendor>(
    `SELECT id, name, preferred
     FROM vendors
     WHERE org_id = $1::uuid
     ORDER BY preferred DESC, lower(name), id`,
    [orgId],
  );
  return result.rows;
}
