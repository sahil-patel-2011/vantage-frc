-- Enforce the two capabilities added in 0620.
--
--   manage_budget — see and set the season budget. Owner/admin implicitly (via
--     has_org_capability), plus anyone an owner or admin grants it to. This is
--     what "mentor" means here, and the product surfaces say so in those words:
--     there is no mentor flag.
--   edit_docs     — create and edit the team's playbook pages. Owner/admin
--     implicitly, plus anyone the OWNER grants it to. Only the owner.
--
-- Neither is self-assignable. The RLS WITH CHECKs and a table CHECK both refuse
-- a row where the grantee is the person writing it. An owner never needs to
-- self-grant: has_org_capability already returns true for owner/admin.

-- ---------------------------------------------------------------- no self-grant
-- Scoped to the two new capabilities so the four capabilities 0049 shipped keep
-- their existing behaviour. Existing rows can only hold those four, so this
-- validates against live data without a rewrite.
ALTER TABLE membership_capabilities
  DROP CONSTRAINT IF EXISTS membership_capabilities_no_self_grant;
ALTER TABLE membership_capabilities
  ADD CONSTRAINT membership_capabilities_no_self_grant
  CHECK (
    capability NOT IN ('manage_budget'::org_capability, 'edit_docs'::org_capability)
    OR user_id <> granted_by
  );

-- ---------------------------------------------------------------- grant paths
--
-- 0049's single admin-write policy let any owner/admin write ANY capability and
-- said nothing about self-grants. Both new capabilities are carved out of it
-- and given their own policy; the four original ones are untouched.

DROP POLICY IF EXISTS membership_capabilities_admin_write ON membership_capabilities;
CREATE POLICY membership_capabilities_admin_write ON membership_capabilities
  FOR ALL TO vantage_app
  USING (
    capability NOT IN ('manage_budget'::org_capability, 'edit_docs'::org_capability)
    AND (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR is_platform_admin())
  )
  WITH CHECK (
    capability NOT IN ('manage_budget'::org_capability, 'edit_docs'::org_capability)
    AND (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR is_platform_admin())
  );

-- Budget access: an owner or admin may delegate it. They already hold it
-- themselves, so this hands out nothing they do not have.
CREATE POLICY membership_capabilities_budget_write ON membership_capabilities
  FOR ALL TO vantage_app
  USING (
    capability = 'manage_budget'::org_capability
    AND (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR is_platform_admin())
  )
  WITH CHECK (
    capability = 'manage_budget'::org_capability
    AND (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR is_platform_admin())
    AND granted_by = current_app_user_id()
    AND user_id <> current_app_user_id()
  );

-- Doc editing: the OWNER only. Not an admin, not the grantee, not anyone who can
-- reach the API. `is_platform_admin()` is here because the platform admin
-- provisions each team and its owner (0000 platform_admins) and is the only
-- account that can recover a team whose owner is gone — and it is bound by the
-- same no-self-grant rule.
CREATE POLICY membership_capabilities_doc_write ON membership_capabilities
  FOR ALL TO vantage_app
  USING (
    capability = 'edit_docs'::org_capability
    AND (has_org_role(org_id, ARRAY['owner']::org_role[]) OR is_platform_admin())
  )
  WITH CHECK (
    capability = 'edit_docs'::org_capability
    AND (has_org_role(org_id, ARRAY['owner']::org_role[]) OR is_platform_admin())
    AND granted_by = current_app_user_id()
    AND user_id <> current_app_user_id()
  );

-- ---------------------------------------------------------------- the budget is mentor-only
--
-- 0070 made season_budgets readable AND writable by every org member. That is
-- the rule this feature exists to change: a student must not be able to read the
-- team's budget, and the DATABASE is what refuses — deleting the checks in
-- apps/web would change the error message, not the outcome.
--
-- Readers affected, all of which already handle a null budget:
--   apps/web/lib/costs/compute-costs.ts   (/costs — now reports canManageBudget
--                                          so it says "mentors only" instead of
--                                          "no budget set", which would be a
--                                          different and possibly untrue claim)
--   apps/web/lib/orders/compute-orders.ts (reads ai_assist_enabled only)
--   apps/web/lib/business-data.ts         (reads ai_assist_enabled only)
--
-- season_costs stays member-readable AND member-writable. Recording what was
-- spent is bookkeeping and every row carries its author; deciding how much there
-- is to spend is the privileged act. /budget shows spend by source so a mentor
-- can see where each dollar was entered.

DROP POLICY IF EXISTS season_budgets_member_read ON season_budgets;
DROP POLICY IF EXISTS season_budgets_member_write ON season_budgets;

CREATE POLICY season_budgets_manager_read ON season_budgets FOR SELECT TO vantage_app
  USING (has_org_capability(org_id, 'manage_budget'::org_capability));
CREATE POLICY season_budgets_manager_write ON season_budgets FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_budget'::org_capability))
  WITH CHECK (
    has_org_capability(org_id, 'manage_budget'::org_capability)
    AND is_org_member(org_id)
  );

-- ---------------------------------------------------------------- a student cannot approve their own ask
--
-- Found by running this against a real database on the app role: 0035's
-- `purchase_requests_member_self_edit` let a requester UPDATE their own row
-- while it was pending, with no restriction on WHICH columns changed — so
-- `UPDATE purchase_requests SET status='approved'` on your own request was
-- accepted. The dollars could not follow (finance_transactions writes stay
-- owner/admin), so no budget moved, but the request still read "Approved —
-- ready to buy" to everyone looking at /orders.
--
-- The requester keeps the point of that policy: fixing their own pending
-- request. They just cannot decide it. Marking an APPROVED request as ordered
-- or received is a different policy (purchase_requests_buyer_progress, 0184)
-- and is untouched.

DROP POLICY IF EXISTS purchase_requests_member_self_edit ON purchase_requests;
CREATE POLICY purchase_requests_member_self_edit ON purchase_requests FOR UPDATE TO vantage_app
  USING (requested_by = current_app_user_id() AND status = 'pending')
  WITH CHECK (
    requested_by = current_app_user_id()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND ordered_at IS NULL
    AND received_at IS NULL
  );

-- ---------------------------------------------------------------- docs are a role
--
-- 0149_team_wiki.sql let any member insert/update/delete a wiki page. Reading
-- stays open to the whole team — a playbook nobody can read is pointless — but
-- authoring is now the granted role.
--
-- Owner/admin keep it implicitly through has_org_capability, which matters: the
-- automated publish paths (exit-interview handoffs, approved knowledge-capture
-- drafts, the Notion/Sheets importer) are already gated to owner/admin, so they
-- keep working. A scout or viewer now needs the owner's grant.

DROP POLICY IF EXISTS knowledge_pages_member_insert ON knowledge_pages;
DROP POLICY IF EXISTS knowledge_pages_member_update ON knowledge_pages;
DROP POLICY IF EXISTS knowledge_pages_member_delete ON knowledge_pages;

CREATE POLICY knowledge_pages_editor_insert ON knowledge_pages FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_capability(org_id, 'edit_docs'::org_capability)
    AND created_by = current_app_user_id()
  );
CREATE POLICY knowledge_pages_editor_update ON knowledge_pages FOR UPDATE TO vantage_app
  USING (has_org_capability(org_id, 'edit_docs'::org_capability))
  WITH CHECK (has_org_capability(org_id, 'edit_docs'::org_capability));
CREATE POLICY knowledge_pages_editor_delete ON knowledge_pages FOR DELETE TO vantage_app
  USING (
    has_org_capability(org_id, 'edit_docs'::org_capability)
    AND (
      has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR created_by = current_app_user_id()
    )
  );

COMMENT ON COLUMN membership_capabilities.capability IS
  'Delegated power beside org_role (0049). manage_budget and edit_docs (0620) are '
  'never self-assignable; edit_docs may only be granted by the org owner.';
