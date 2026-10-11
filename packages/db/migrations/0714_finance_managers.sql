-- Finance managers: the team owner chooses who may change the team's money.
--
-- THE RULE
--   A finance manager is the team OWNER (always), or an admin / team member the
--   owner has explicitly granted the existing `manage_budget` capability (0620),
--   which the product now calls "Manage money". Admins are no longer implicit
--   finance managers. A view-only member can never hold it.
--
--   Only an owner (or the platform admin recovering a team) can grant or revoke
--   it, and nobody can grant it to themselves (0621's CHECK still applies).
--
-- WHAT IT COVERS
--   Every write that records, moves, budgets or decides team money:
--     finance_categories, finance_budget_plans, finance_season_settings,
--     finance_transactions (the ledger), finance_audit_log, finance_funding_sources,
--     finance_purchase_log, sponsor_contributions, season_budgets, season_costs,
--     season_subscriptions, fundraiser proceeds, grant_finance_allocations,
--     reimbursement review/payment, purchase-request decisions, grant awards and
--     partner-placement payment status.
--   Members keep: asking for things (purchase/part/order requests), filing and
--   fixing their own reimbursement claims before a decision, running fundraiser
--   events without touching their proceeds, and READING money (transparency).
--   Viewers keep read-only access and lose every money write.
--
-- WHY A FUNCTION, NOT org_role
--   Same reasoning as 0620/0710: org_role is referenced by ~1,800 policies. The
--   capability table already carries per-person grants, so one SECURITY DEFINER
--   predicate answers "may this person change money?" for every policy below.
--
-- POLICY NAMES
--   Policies whose audience simply narrows keep their names (…_admin_write now
--   means "finance managers"). Policies that used to be open to every member and
--   now are not are dropped and recreated under a …_finance_… name, so nobody
--   reads `season_costs_member_insert` and assumes members can still insert.
--   Every replaced name is dropped first; a permissive policy left behind would
--   OR back in and silently undo this file.
--
-- Safe to re-run: functions are CREATE OR REPLACE, policies are DROP IF EXISTS +
-- CREATE, triggers are DROP IF EXISTS + CREATE, and the one data change (the
-- admin backfill) only runs the first time, before can_manage_finances exists.

-- ---------------------------------------------------------------- backfill (first run only)
--
-- Today every admin can change money. Keep that for existing teams by granting
-- each current admin "Manage money" in the owner's name; owners can revoke it
-- from Team admin → Access. Teams without an owner are skipped (nobody could
-- legitimately grant it), and an admin is never the oldest owner of the same
-- team, so 0621's no-self-grant CHECK always holds.
DO $$
BEGIN
  IF to_regprocedure('public.can_manage_finances(uuid)') IS NULL THEN
    INSERT INTO membership_capabilities (org_id, user_id, capability, granted_by)
    SELECT m.org_id, m.user_id, 'manage_budget'::org_capability, owner_row.user_id
      FROM memberships m
      JOIN LATERAL (
        SELECT o.user_id
          FROM memberships o
         WHERE o.org_id = m.org_id AND o.role = 'owner'
         ORDER BY o.created_at, o.user_id
         LIMIT 1
      ) owner_row ON true
     WHERE m.role = 'admin'
       AND owner_row.user_id <> m.user_id
    ON CONFLICT (org_id, user_id, capability) DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------- the predicate

CREATE OR REPLACE FUNCTION can_manage_finances(target_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_org_member(target_org_id)
     AND (
       has_org_role(target_org_id, ARRAY['owner']::org_role[])
       OR (
         -- A grant only counts for an admin or team member. A viewer is look-only
         -- even if a stale row survived a role change.
         has_org_role(target_org_id, ARRAY['admin', 'scout']::org_role[])
         AND EXISTS (
           SELECT 1
             FROM membership_capabilities c
            WHERE c.org_id = target_org_id
              AND c.user_id = current_app_user_id()
              AND c.capability = 'manage_budget'::org_capability
         )
       )
     )
$$;
REVOKE ALL ON FUNCTION can_manage_finances(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_manage_finances(uuid) TO vantage_app, vantage_worker;

COMMENT ON FUNCTION can_manage_finances(uuid) IS
  'Finance manager = the org owner, or an admin/team member holding an explicit '
  'manage_budget ("Manage money") grant from an owner. Admins are not implicit.';

-- One money permission everywhere: has_org_capability(org, 'manage_budget') used
-- to be true for every admin. It now answers exactly what can_manage_finances
-- answers; every other capability keeps 0049's behaviour unchanged.
CREATE OR REPLACE FUNCTION has_org_capability(target_org_id uuid, needed org_capability)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN needed = 'manage_budget'::org_capability THEN can_manage_finances(target_org_id)
    ELSE EXISTS (
      SELECT 1
      FROM memberships m
      WHERE m.org_id = target_org_id
        AND m.user_id = current_app_user_id()
        AND (
          m.role IN ('owner', 'admin')
          OR EXISTS (
            SELECT 1
            FROM membership_capabilities c
            WHERE c.org_id = m.org_id
              AND c.user_id = m.user_id
              AND c.capability = needed
          )
        )
    )
  END
$$;
REVOKE ALL ON FUNCTION has_org_capability(uuid, org_capability) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_org_capability(uuid, org_capability) TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------- who may grant it: the owner

DROP POLICY IF EXISTS membership_capabilities_budget_write ON membership_capabilities;
CREATE POLICY membership_capabilities_budget_write ON membership_capabilities
  FOR ALL TO vantage_app
  USING (
    capability = 'manage_budget'::org_capability
    AND (has_org_role(org_id, ARRAY['owner']::org_role[]) OR is_platform_admin())
  )
  WITH CHECK (
    capability = 'manage_budget'::org_capability
    AND (has_org_role(org_id, ARRAY['owner']::org_role[]) OR is_platform_admin())
    AND granted_by = current_app_user_id()
    AND user_id <> current_app_user_id()
  );

-- Only an admin or team member can hold it. An owner already manages money, and
-- a viewer is look-only: the owner changes their access first.
CREATE OR REPLACE FUNCTION finance_manager_grant_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role org_role;
BEGIN
  IF NEW.capability <> 'manage_budget'::org_capability THEN
    RETURN NEW;
  END IF;
  SELECT role INTO v_role FROM memberships WHERE org_id = NEW.org_id AND user_id = NEW.user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'That person is not on this team.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_role = 'viewer' THEN
    RAISE EXCEPTION 'View-only people can''t manage money. Change their access to Team member or Team admin first.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'Owners already manage money.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION finance_manager_grant_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS membership_capabilities_finance_guard ON membership_capabilities;
CREATE TRIGGER membership_capabilities_finance_guard
  BEFORE INSERT OR UPDATE ON membership_capabilities
  FOR EACH ROW EXECUTE FUNCTION finance_manager_grant_guard();

-- Leaving the team, or becoming view-only, ends money access. This runs whoever
-- made the change (an admin removing a member cannot delete an owner-granted row
-- under the policy above, and a stale row must not come back on re-join).
CREATE OR REPLACE FUNCTION finance_manager_membership_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM membership_capabilities
     WHERE org_id = OLD.org_id AND user_id = OLD.user_id
       AND capability = 'manage_budget'::org_capability;
    RETURN OLD;
  END IF;
  IF NEW.role = 'viewer' AND OLD.role IS DISTINCT FROM 'viewer' THEN
    DELETE FROM membership_capabilities
     WHERE org_id = NEW.org_id AND user_id = NEW.user_id
       AND capability = 'manage_budget'::org_capability;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION finance_manager_membership_sync() FROM PUBLIC;

DROP TRIGGER IF EXISTS memberships_finance_manager_sync ON memberships;
CREATE TRIGGER memberships_finance_manager_sync
  AFTER UPDATE OF role OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION finance_manager_membership_sync();

-- ---------------------------------------------------------------- budgets and categories

DROP POLICY IF EXISTS finance_categories_admin_write ON finance_categories;
CREATE POLICY finance_categories_admin_write ON finance_categories FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));

DROP POLICY IF EXISTS finance_budget_plans_admin_write ON finance_budget_plans;
CREATE POLICY finance_budget_plans_admin_write ON finance_budget_plans FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id) AND set_by = current_app_user_id());

DROP POLICY IF EXISTS finance_season_settings_admin_write ON finance_season_settings;
CREATE POLICY finance_season_settings_admin_write ON finance_season_settings FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id) AND updated_by = current_app_user_id());

-- The season budget was manager-read/manager-write since 0621; "manager" now
-- means finance manager, not "owner or any admin".
DROP POLICY IF EXISTS season_budgets_manager_read ON season_budgets;
CREATE POLICY season_budgets_manager_read ON season_budgets FOR SELECT TO vantage_app
  USING (can_manage_finances(org_id));
DROP POLICY IF EXISTS season_budgets_manager_write ON season_budgets;
CREATE POLICY season_budgets_manager_write ON season_budgets FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id) AND is_org_member(org_id));

-- ---------------------------------------------------------------- the ledger
--
-- 0035's single FOR ALL policy required created_by = me on UPDATE too, so a
-- second finance manager could never re-sync a mirror row the first one created
-- (e.g. adding fundraiser proceeds someone else started). Split by command:
-- inserts are still attributed to the writer; updates and deletes are not.
--
-- 0461's member mirror policies let ANY member insert season_cost/purchase_log/
-- bom rows with any amount, direction or counts_in_balance — enough to forge
-- income. Season costs and receipts are finance-manager writes now; a BOM
-- estimate (an engineering number, never cash) stays member-writable but can
-- only ever land as a non-counting expense.
DROP POLICY IF EXISTS finance_transactions_admin_write ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_member_mirror_insert ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_member_mirror_update ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_member_mirror_delete ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_finance_insert ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_finance_update ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_finance_delete ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_bom_estimate_insert ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_bom_estimate_update ON finance_transactions;
DROP POLICY IF EXISTS finance_transactions_bom_estimate_delete ON finance_transactions;

CREATE POLICY finance_transactions_finance_insert ON finance_transactions FOR INSERT TO vantage_app
  WITH CHECK (can_manage_finances(org_id) AND created_by = current_app_user_id());
CREATE POLICY finance_transactions_finance_update ON finance_transactions FOR UPDATE TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));
CREATE POLICY finance_transactions_finance_delete ON finance_transactions FOR DELETE TO vantage_app
  USING (can_manage_finances(org_id));

CREATE POLICY finance_transactions_bom_estimate_insert ON finance_transactions FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND source_kind = 'bom'
    AND type = 'expense'::finance_txn_type
    AND counts_in_balance = false
  );
CREATE POLICY finance_transactions_bom_estimate_update ON finance_transactions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND source_kind = 'bom' AND counts_in_balance = false)
  WITH CHECK (
    is_org_member(org_id)
    AND source_kind = 'bom'
    AND type = 'expense'::finance_txn_type
    AND counts_in_balance = false
  );
CREATE POLICY finance_transactions_bom_estimate_delete ON finance_transactions FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND source_kind = 'bom' AND counts_in_balance = false);

-- Finance managers append their own audit lines. Members (not viewers) keep
-- their narrow reimbursement.* lane from 0482 — filing a claim is still theirs.
DROP POLICY IF EXISTS finance_audit_log_admin_insert ON finance_audit_log;
CREATE POLICY finance_audit_log_admin_insert ON finance_audit_log FOR INSERT TO vantage_app
  WITH CHECK (can_manage_finances(org_id) AND actor_user_id = current_app_user_id());
DROP POLICY IF EXISTS finance_audit_log_member_reimbursement_insert ON finance_audit_log;
CREATE POLICY finance_audit_log_member_reimbursement_insert ON finance_audit_log FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[])
    AND actor_user_id = current_app_user_id()
    AND action LIKE 'reimbursement.%'
  );

-- ---------------------------------------------------------------- income and spend records

DROP POLICY IF EXISTS finance_funding_sources_admin_insert ON finance_funding_sources;
CREATE POLICY finance_funding_sources_admin_insert ON finance_funding_sources FOR INSERT TO vantage_app
  WITH CHECK (can_manage_finances(org_id) AND created_by = current_app_user_id());
DROP POLICY IF EXISTS finance_funding_sources_admin_update ON finance_funding_sources;
CREATE POLICY finance_funding_sources_admin_update ON finance_funding_sources FOR UPDATE TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));
DROP POLICY IF EXISTS finance_funding_sources_admin_delete ON finance_funding_sources;
CREATE POLICY finance_funding_sources_admin_delete ON finance_funding_sources FOR DELETE TO vantage_app
  USING (can_manage_finances(org_id));

-- Recording what was bought is bookkeeping a finance manager does. A member who
-- needs something submits a purchase request instead.
DROP POLICY IF EXISTS finance_purchase_log_admin_write ON finance_purchase_log;
DROP POLICY IF EXISTS finance_purchase_log_member_insert ON finance_purchase_log;
DROP POLICY IF EXISTS finance_purchase_log_self_update ON finance_purchase_log;
DROP POLICY IF EXISTS finance_purchase_log_self_delete ON finance_purchase_log;
CREATE POLICY finance_purchase_log_admin_write ON finance_purchase_log FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));

DROP POLICY IF EXISTS season_costs_member_insert ON season_costs;
DROP POLICY IF EXISTS season_costs_member_update ON season_costs;
DROP POLICY IF EXISTS season_costs_member_delete ON season_costs;
DROP POLICY IF EXISTS season_costs_finance_insert ON season_costs;
DROP POLICY IF EXISTS season_costs_finance_update ON season_costs;
DROP POLICY IF EXISTS season_costs_finance_delete ON season_costs;
CREATE POLICY season_costs_finance_insert ON season_costs FOR INSERT TO vantage_app
  WITH CHECK (can_manage_finances(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_costs_finance_update ON season_costs FOR UPDATE TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));
CREATE POLICY season_costs_finance_delete ON season_costs FOR DELETE TO vantage_app
  USING (can_manage_finances(org_id));

DROP POLICY IF EXISTS season_subscriptions_member_insert ON season_subscriptions;
DROP POLICY IF EXISTS season_subscriptions_member_update ON season_subscriptions;
DROP POLICY IF EXISTS season_subscriptions_member_delete ON season_subscriptions;
DROP POLICY IF EXISTS season_subscriptions_finance_insert ON season_subscriptions;
DROP POLICY IF EXISTS season_subscriptions_finance_update ON season_subscriptions;
DROP POLICY IF EXISTS season_subscriptions_finance_delete ON season_subscriptions;
CREATE POLICY season_subscriptions_finance_insert ON season_subscriptions FOR INSERT TO vantage_app
  WITH CHECK (can_manage_finances(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_subscriptions_finance_update ON season_subscriptions FOR UPDATE TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));
CREATE POLICY season_subscriptions_finance_delete ON season_subscriptions FOR DELETE TO vantage_app
  USING (can_manage_finances(org_id));

DROP POLICY IF EXISTS grant_finance_allocations_member_insert ON grant_finance_allocations;
DROP POLICY IF EXISTS grant_finance_allocations_member_update ON grant_finance_allocations;
DROP POLICY IF EXISTS grant_finance_allocations_member_delete ON grant_finance_allocations;
DROP POLICY IF EXISTS grant_finance_allocations_finance_insert ON grant_finance_allocations;
DROP POLICY IF EXISTS grant_finance_allocations_finance_update ON grant_finance_allocations;
DROP POLICY IF EXISTS grant_finance_allocations_finance_delete ON grant_finance_allocations;
CREATE POLICY grant_finance_allocations_finance_insert ON grant_finance_allocations FOR INSERT TO vantage_app
  WITH CHECK (can_manage_finances(org_id) AND created_by = current_app_user_id());
CREATE POLICY grant_finance_allocations_finance_update ON grant_finance_allocations FOR UPDATE TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));
CREATE POLICY grant_finance_allocations_finance_delete ON grant_finance_allocations FOR DELETE TO vantage_app
  USING (can_manage_finances(org_id));

-- ---------------------------------------------------------------- sponsor money
--
-- Recording, correcting or deleting a contribution is a finance write. Sponsor
-- leads (owner/admin) still run the relationship: they may mark a thank-you as
-- sent, and the trigger below makes sure that is ALL a non-finance update can
-- change — permissive policies OR together, so a column rule needs a trigger.
DROP POLICY IF EXISTS sponsor_contributions_admin_write ON sponsor_contributions;
CREATE POLICY sponsor_contributions_admin_write ON sponsor_contributions FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));
DROP POLICY IF EXISTS sponsor_contributions_lead_thank_you ON sponsor_contributions;
CREATE POLICY sponsor_contributions_lead_thank_you ON sponsor_contributions FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE OR REPLACE FUNCTION sponsor_contribution_money_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_app_user_id() IS NULL OR can_manage_finances(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'thank_you_sent_at') IS DISTINCT FROM (to_jsonb(OLD) - 'thank_you_sent_at') THEN
    RAISE EXCEPTION 'Only people your team owner chose can change money. Ask an owner for access.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION sponsor_contribution_money_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS sponsor_contributions_money_guard ON sponsor_contributions;
CREATE TRIGGER sponsor_contributions_money_guard
  BEFORE UPDATE ON sponsor_contributions
  FOR EACH ROW EXECUTE FUNCTION sponsor_contribution_money_guard();

-- A placement campaign's payment status decides whether a sponsor paid; marking
-- it paid or waived is a money decision, the rest of the campaign is not.
CREATE OR REPLACE FUNCTION partner_campaign_payment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_app_user_id() IS NULL OR can_manage_finances(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.contribution_id IS DISTINCT FROM OLD.contribution_id
     OR (NEW.amount_usd IS DISTINCT FROM OLD.amount_usd AND OLD.payment_status IN ('paid', 'waived')) THEN
    RAISE EXCEPTION 'Only people your team owner chose can change money. Ask an owner for access.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION partner_campaign_payment_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS partner_campaign_payment_guard_trg ON partner_placement_campaigns;
CREATE TRIGGER partner_campaign_payment_guard_trg
  BEFORE UPDATE ON partner_placement_campaigns
  FOR EACH ROW EXECUTE FUNCTION partner_campaign_payment_guard();

-- ---------------------------------------------------------------- grant awards
--
-- An awarded grant is income on the ledger. Writing the award (status into or
-- out of 'awarded', or the awarded amount) is a finance write; drafting and
-- submitting stay with whoever already could. A team-member finance manager
-- may record an award, which 0035's member policies refuse for 'awarded' rows.
CREATE OR REPLACE FUNCTION grant_award_money_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_app_user_id() IS NULL OR can_manage_finances(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'awarded'::grant_status OR COALESCE(NEW.amount_awarded_usd, 0) <> 0 THEN
      RAISE EXCEPTION 'Only people your team owner chose can change money. Ask an owner for access.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.status = 'awarded'::grant_status) IS DISTINCT FROM (OLD.status = 'awarded'::grant_status)
     OR (NEW.status = 'awarded'::grant_status AND NEW.amount_awarded_usd IS DISTINCT FROM OLD.amount_awarded_usd) THEN
    RAISE EXCEPTION 'Only people your team owner chose can change money. Ask an owner for access.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION grant_award_money_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS grant_applications_award_guard ON grant_applications;
CREATE TRIGGER grant_applications_award_guard
  BEFORE INSERT OR UPDATE ON grant_applications
  FOR EACH ROW EXECUTE FUNCTION grant_award_money_guard();

DROP POLICY IF EXISTS grant_applications_finance_insert ON grant_applications;
CREATE POLICY grant_applications_finance_insert ON grant_applications FOR INSERT TO vantage_app
  WITH CHECK (can_manage_finances(org_id));
DROP POLICY IF EXISTS grant_applications_finance_update ON grant_applications;
CREATE POLICY grant_applications_finance_update ON grant_applications FOR UPDATE TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));

-- ---------------------------------------------------------------- fundraisers
--
-- Members (not viewers) still plan and run fundraiser events. Proceeds are
-- money: recording them, changing the status of an event that has proceeds, or
-- deleting one is a finance write, enforced by the trigger below.
DROP POLICY IF EXISTS fundraiser_events_insert ON fundraiser_events;
CREATE POLICY fundraiser_events_insert ON fundraiser_events FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[])
    AND created_by = current_app_user_id()
  );
DROP POLICY IF EXISTS fundraiser_events_update ON fundraiser_events;
CREATE POLICY fundraiser_events_update ON fundraiser_events FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]));
DROP POLICY IF EXISTS fundraiser_events_delete ON fundraiser_events;
CREATE POLICY fundraiser_events_delete ON fundraiser_events FOR DELETE TO vantage_app
  USING (
    (created_by = current_app_user_id() AND has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]))
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR can_manage_finances(org_id)
  );

CREATE OR REPLACE FUNCTION fundraiser_proceeds_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.org_id ELSE NEW.org_id END;
BEGIN
  IF current_app_user_id() IS NULL OR can_manage_finances(v_org) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.proceeds_usd, 0) <> 0 THEN
      RAISE EXCEPTION 'Only people your team owner chose can change money. Ask an owner for access.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.proceeds_usd, 0) <> 0 THEN
      RAISE EXCEPTION 'Only people your team owner chose can change money. Ask an owner for access.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.proceeds_usd IS DISTINCT FROM OLD.proceeds_usd
     OR (COALESCE(OLD.proceeds_usd, 0) <> 0
         AND (NEW.status IS DISTINCT FROM OLD.status
              OR NEW.season_year IS DISTINCT FROM OLD.season_year
              OR NEW.org_id IS DISTINCT FROM OLD.org_id)) THEN
    RAISE EXCEPTION 'Only people your team owner chose can change money. Ask an owner for access.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION fundraiser_proceeds_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS fundraiser_events_proceeds_guard ON fundraiser_events;
CREATE TRIGGER fundraiser_events_proceeds_guard
  BEFORE INSERT OR UPDATE OR DELETE ON fundraiser_events
  FOR EACH ROW EXECUTE FUNCTION fundraiser_proceeds_guard();

-- ---------------------------------------------------------------- reimbursements
--
-- Finance managers see and decide every claim. Members (not viewers) file, fix
-- and withdraw their own before a decision, exactly as 0482 allowed.
DROP POLICY IF EXISTS reimbursement_requests_admin_read ON reimbursement_requests;
CREATE POLICY reimbursement_requests_admin_read ON reimbursement_requests FOR SELECT TO vantage_app
  USING (can_manage_finances(org_id));
DROP POLICY IF EXISTS reimbursement_requests_admin_write ON reimbursement_requests;
CREATE POLICY reimbursement_requests_admin_write ON reimbursement_requests FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));

DROP POLICY IF EXISTS reimbursement_requests_self_insert ON reimbursement_requests;
CREATE POLICY reimbursement_requests_self_insert ON reimbursement_requests FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[])
    AND member_user_id = current_app_user_id()
    AND status IN ('draft', 'submitted')
    AND approver_user_id IS NULL
  );
DROP POLICY IF EXISTS reimbursement_requests_self_update ON reimbursement_requests;
CREATE POLICY reimbursement_requests_self_update ON reimbursement_requests FOR UPDATE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[])
    AND member_user_id = current_app_user_id()
    AND status IN ('draft', 'submitted', 'denied')
  )
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[])
    AND member_user_id = current_app_user_id()
    AND status IN ('draft', 'submitted')
    AND approver_user_id IS NULL
  );
DROP POLICY IF EXISTS reimbursement_requests_self_delete ON reimbursement_requests;
CREATE POLICY reimbursement_requests_self_delete ON reimbursement_requests FOR DELETE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[])
    AND member_user_id = current_app_user_id()
    AND status IN ('draft', 'submitted', 'denied')
  );

-- ---------------------------------------------------------------- purchase requests
--
-- Anyone who can change things may ASK (viewers are look-only). Deciding,
-- re-pricing and every other write on someone else's request is a finance write.
DROP POLICY IF EXISTS purchase_requests_admin_write ON purchase_requests;
CREATE POLICY purchase_requests_admin_write ON purchase_requests FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));
DROP POLICY IF EXISTS purchase_requests_member_insert ON purchase_requests;
CREATE POLICY purchase_requests_member_insert ON purchase_requests FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[])
    AND requested_by = current_app_user_id()
  );

-- 0622's guard, with "leadership" meaning finance managers. It also locks the
-- approved dollars: once a request is decided, only a finance manager may change
-- what it costs or where it is charged (the buyer still moves it along).
CREATE OR REPLACE FUNCTION purchase_request_decision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- No RLS context: the worker role (vantage_worker, BYPASSRLS) and migrations.
  IF current_app_user_id() IS NULL THEN
    RETURN NEW;
  END IF;

  IF can_manage_finances(NEW.org_id) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Only a finance manager can decide a purchase request. Ask an owner for access.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
    RAISE EXCEPTION 'Only a finance manager can record a purchase-request decision. Ask an owner for access.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status <> 'pending'
     AND (NEW.quantity IS DISTINCT FROM OLD.quantity
          OR NEW.unit_cost_usd IS DISTINCT FROM OLD.unit_cost_usd
          OR NEW.total_cost_usd IS DISTINCT FROM OLD.total_cost_usd
          OR NEW.shipping_cost_usd IS DISTINCT FROM OLD.shipping_cost_usd
          OR NEW.category_id IS DISTINCT FROM OLD.category_id
          OR NEW.season_year IS DISTINCT FROM OLD.season_year) THEN
    RAISE EXCEPTION 'Only people your team owner chose can change money. Ask an owner for access.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION purchase_request_decision_guard() FROM PUBLIC;
COMMENT ON FUNCTION purchase_request_decision_guard() IS
  'Deciding a purchase request, and changing an already-decided request''s dollars, '
  'is finance-manager only (0714). A trigger because permissive policies OR together '
  'and the rule is about a transition, which a WITH CHECK cannot see.';

COMMENT ON COLUMN membership_capabilities.capability IS
  'Delegated power beside org_role (0049). manage_budget ("Manage money", 0714) is granted '
  'only by the owner, only to an admin or team member, and is what can_manage_finances() '
  'reads. edit_docs may only be granted by the owner. Neither is self-assignable.';
