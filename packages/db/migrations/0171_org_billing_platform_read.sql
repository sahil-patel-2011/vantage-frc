-- Platform admins need org_billing Stripe IDs for the /admin/plans ledger.
-- Members retain billing_member_read; this only adds a platform SELECT path.

DROP POLICY IF EXISTS org_billing_platform_read ON org_billing;
CREATE POLICY org_billing_platform_read ON org_billing FOR SELECT TO vantage_app
  USING (is_platform_admin());
