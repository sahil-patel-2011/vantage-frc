-- A student could approve their own part request. Found by running the RLS
-- suite against a real Postgres on the vantage_app role.
--
-- HOW TWO CORRECT POLICIES ADDED UP TO A WRONG ONE
-- Permissive policies are OR'd — including their WITH CHECKs — so an UPDATE is
-- allowed when ANY policy's USING matches the old row and ANY policy's WITH
-- CHECK matches the new one. They do not have to be the same policy.
--
--   purchase_requests_member_self_edit (0035, tightened in 0621)
--     USING: requested_by = me AND status = 'pending'      <- matches the OLD row
--   purchase_requests_buyer_progress (0184)
--     WITH CHECK: status IN ('approved','ordered','received')
--                 AND (buyer_user_id = me
--                      OR (buyer_user_id IS NULL AND requested_by = me))
--                                                          <- matches the NEW row
--
-- So `UPDATE purchase_requests SET status='approved'` on your own pending
-- request was accepted: the first policy let the row be touched, the second let
-- it land on 'approved'. Both policies are individually reasonable — one lets
-- you fix your own pending ask, the other lets the buyer attach a product URL
-- to an already-approved order without changing its status.
--
-- Tightening 0621's WITH CHECK did not fix it, and no WITH CHECK can: a WITH
-- CHECK sees only the new row, and the rule here is about a TRANSITION —
-- pending -> anything is a decision, and a decision is privileged. Comparing
-- OLD to NEW is what a trigger is for.
--
-- The dollars were never at risk: finance_transactions writes stay owner/admin,
-- so a self-approved request moved no money and changed no budget. But it read
-- "Approved — ready to buy" to the whole team on /orders, which is exactly the
-- claim the approval step exists to make.

CREATE OR REPLACE FUNCTION purchase_request_decision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- No RLS context: the worker role (vantage_worker, BYPASSRLS) and migrations.
  -- Those are trusted paths that never run as a person.
  IF current_app_user_id() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Leadership decides. This is the same pair every other finance write uses.
  IF has_org_role(NEW.org_id, ARRAY['owner', 'admin']::org_role[]) THEN
    RETURN NEW;
  END IF;

  -- Moving a request OFF pending is the decision itself.
  IF OLD.status = 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Only an owner or admin can decide a purchase request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- And nobody else writes the decision's fingerprints, in any transition.
  IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
    RAISE EXCEPTION 'Only an owner or admin can record a purchase-request decision'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Deliberately still allowed for a buyer or the requester: approved -> ordered
  -- -> received, and attaching a product URL. Those are not decisions, and
  -- purchase_requests_buyer_progress (0184) already scopes who may do them.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION purchase_request_decision_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS purchase_request_decision_guard_trg ON purchase_requests;
CREATE TRIGGER purchase_request_decision_guard_trg
  BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION purchase_request_decision_guard();

COMMENT ON FUNCTION purchase_request_decision_guard() IS
  'Approving/rejecting a purchase request is owner/admin only. A trigger, not a '
  'policy, because permissive RLS policies OR together and the rule is about the '
  'pending -> decided transition, which a WITH CHECK cannot see.';
