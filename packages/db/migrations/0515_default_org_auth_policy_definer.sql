-- Creating an organization failed for every caller with
--   "new row violates row-level security policy for table org_auth_policies".
--
-- 0010 added an AFTER INSERT trigger on `organizations` that seeds the default
-- auth policy row. The trigger function is SECURITY INVOKER, so the seeding
-- INSERT is checked against org_auth_policies' only write policy:
--   has_org_role(org_id, owner/admin) AND updated_by = current_app_user_id()
-- At the instant the organization row is inserted nobody is a member of it yet
-- and `updated_by` is NULL, so the check can never pass. That blocked platform
-- admin provisioning (/api/admin/organizations, both the seeded and invited
-- owner paths) and any other org create as vantage_app.
--
-- The row this trigger writes is a fixed set of column defaults keyed by the new
-- organization's own id — no caller input — so it is safe to seed as the owner
-- of the function. Reads and admin edits keep the existing RLS policies.

CREATE OR REPLACE FUNCTION create_default_org_auth_policy() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO org_auth_policies(org_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION create_default_org_auth_policy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_default_org_auth_policy() TO vantage_app, vantage_worker;

-- Backfill any organization created before this fix that has no policy row.
INSERT INTO org_auth_policies(org_id)
SELECT o.id FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM org_auth_policies p WHERE p.org_id = o.id);
