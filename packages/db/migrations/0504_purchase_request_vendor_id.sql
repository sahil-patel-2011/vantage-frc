-- purchase_requests.vendor stays the denormalized display name.
-- vendor_id is the vendor-directory identity. New writes require a directory UUID
-- (apps/web/lib/finance/purchase-request.ts); free-text names are not identity.
-- Legacy name-only rows are backfilled by org + lower(name) when a unique match exists.

ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchase_requests_org_vendor_idx
  ON purchase_requests(org_id, vendor_id)
  WHERE vendor_id IS NOT NULL;

UPDATE purchase_requests pr
SET vendor_id = matched.id
FROM (
  SELECT DISTINCT ON (org_id, lower(name))
    id, org_id, lower(name) AS name_key
  FROM vendors
  ORDER BY org_id, lower(name), preferred DESC, created_at, id
) matched
WHERE pr.vendor_id IS NULL
  AND matched.org_id = pr.org_id
  AND matched.name_key = lower(pr.vendor);

COMMENT ON COLUMN purchase_requests.vendor_id IS
  'Vendor directory row. Required on new writes; NULL only for unmatched legacy name-only rows.';
