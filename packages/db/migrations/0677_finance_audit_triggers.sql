-- Every change to the team's money leaves a trail (docs/FINANCE_SECURITY.md, G2).
--
-- Only budget plans, purchase requests and reimbursements wrote finance_audit_log,
-- each from its own API route. The season finance desk (funding sources and the
-- purchase log), sponsor contributions, fundraiser events and season costs/budgets
-- wrote nothing, and a delete on any of them left no record at all.
--
-- A trigger rather than more route code: it fires for every INSERT, UPDATE and DELETE
-- whichever path made it (API route, Excel import, a future worker), and a route that
-- forgets cannot skip it. The row before and after is stored whole, the same shape the
-- route-written entries use, and action reads "<table>.<insert|update|delete>".
--
-- finance_audit_log only lets owners/admins insert (0035), but members may legitimately
-- log a purchase or edit a season cost, so the trigger function is SECURITY DEFINER.
-- It writes one row and nothing else; the actor is always the session's own user
-- (current_app_user_id()), never a value the caller supplies. A write with no app user
-- (worker/system maintenance) is not attributed to anyone and is skipped, because
-- actor_user_id is NOT NULL and a trail with an invented actor is worse than none.
--
-- Every audited table is already readable by every member of the team, and so is
-- finance_audit_log, so the trail shows nobody anything they could not already see.

CREATE OR REPLACE FUNCTION finance_audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := current_app_user_id();
  v_org uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_org := OLD.org_id;
    -- A team being deleted cascades into these tables; its audit log is going with it,
    -- and an insert naming the vanished org would fail the foreign key and block the
    -- deletion itself.
    IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org) THEN
      RETURN NULL;
    END IF;
  ELSE
    v_org := NEW.org_id;
  END IF;
  -- An UPDATE that changed nothing (a re-save of the same values) is not an event.
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NULL;
  END IF;
  INSERT INTO finance_audit_log (org_id, actor_user_id, action, before, after)
  VALUES (
    v_org,
    v_actor,
    TG_TABLE_NAME || '.' || lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION finance_audit_row_change() FROM PUBLIC;

CREATE TRIGGER finance_funding_sources_audit
  AFTER INSERT OR UPDATE OR DELETE ON finance_funding_sources
  FOR EACH ROW EXECUTE FUNCTION finance_audit_row_change();

CREATE TRIGGER finance_purchase_log_audit
  AFTER INSERT OR UPDATE OR DELETE ON finance_purchase_log
  FOR EACH ROW EXECUTE FUNCTION finance_audit_row_change();

CREATE TRIGGER sponsor_contributions_audit
  AFTER INSERT OR UPDATE OR DELETE ON sponsor_contributions
  FOR EACH ROW EXECUTE FUNCTION finance_audit_row_change();

CREATE TRIGGER fundraiser_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON fundraiser_events
  FOR EACH ROW EXECUTE FUNCTION finance_audit_row_change();

CREATE TRIGGER season_costs_audit
  AFTER INSERT OR UPDATE OR DELETE ON season_costs
  FOR EACH ROW EXECUTE FUNCTION finance_audit_row_change();

CREATE TRIGGER season_budgets_audit
  AFTER INSERT OR UPDATE OR DELETE ON season_budgets
  FOR EACH ROW EXECUTE FUNCTION finance_audit_row_change();
