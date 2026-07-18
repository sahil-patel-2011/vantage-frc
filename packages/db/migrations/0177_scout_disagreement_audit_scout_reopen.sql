-- Allow scouts to append reopen audit rows when sync reopens a resolved conflict.

DROP POLICY IF EXISTS scout_disagreement_audit_member_insert ON scout_disagreement_audit;
CREATE POLICY scout_disagreement_audit_member_insert ON scout_disagreement_audit FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND actor_user_id = current_app_user_id()
    AND has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[])
  );
