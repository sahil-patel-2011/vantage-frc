-- Scouting forms belong to the team, not to the owner.
--
-- Anyone on the team can build a scouting form, use anyone else's, edit one
-- together, or delete one — the way a shared forms tool works. Until now
-- scout_schemas allowed INSERT only for owner/admin, so a student who wanted a
-- field added read "Ask an owner to publish" and stopped. Worse, there was no
-- UPDATE and no DELETE policy at all, so with RLS on, *nobody* could edit or
-- remove a form once it existed, not even the owner who created it.
--
-- Deleting stays safe without a policy guard: match_scout_entries.schema_id and
-- pit_scout_entries.schema_id reference this table with no ON DELETE clause, so
-- Postgres refuses to drop a form that already has scouting filed under it. A
-- form with real data cannot be deleted by anyone; an empty draft can be
-- deleted by anyone. That is the behaviour we want, and the database enforces
-- it rather than the application remembering to.

DROP POLICY IF EXISTS scout_schemas_coach_write ON scout_schemas;

-- created_by still has to be the person inserting: it is the authorship record,
-- not a permission, and letting it be set to someone else would misattribute
-- every form.
CREATE POLICY scout_schemas_member_insert ON scout_schemas FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

-- Collaborative on purpose: several people shape one form. The WITH CHECK keeps
-- an edit from moving a form into another team.
CREATE POLICY scout_schemas_member_update ON scout_schemas FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY scout_schemas_member_delete ON scout_schemas FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_schemas TO vantage_app;

COMMENT ON TABLE scout_schemas IS
  'Scouting forms. Any team member may create, edit, use or delete one; a form with entries filed under it cannot be deleted, because the entry tables reference it without ON DELETE.';
