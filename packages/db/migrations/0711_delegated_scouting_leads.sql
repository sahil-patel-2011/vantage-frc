-- A scouting lead manages scouting without acquiring unrelated team-admin powers.
-- Read policies stay team-scoped. Existing author identity and foreign-key guards remain.
CREATE FUNCTION can_manage_scouting(target_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT has_org_capability(target_org_id, 'manage_scouting'::org_capability)
$$;
REVOKE ALL ON FUNCTION can_manage_scouting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_manage_scouting(uuid) TO vantage_app, vantage_worker;

DROP POLICY IF EXISTS scout_schemas_member_insert ON scout_schemas;
DROP POLICY IF EXISTS scout_schemas_member_update ON scout_schemas;
DROP POLICY IF EXISTS scout_schemas_member_delete ON scout_schemas;
CREATE POLICY scout_schemas_lead_insert ON scout_schemas FOR INSERT TO vantage_app
  WITH CHECK(can_manage_scouting(org_id) AND created_by=current_app_user_id());
CREATE POLICY scout_schemas_lead_update ON scout_schemas FOR UPDATE TO vantage_app
  USING(can_manage_scouting(org_id)) WITH CHECK(can_manage_scouting(org_id));
CREATE POLICY scout_schemas_lead_delete ON scout_schemas FOR DELETE TO vantage_app USING(can_manage_scouting(org_id));
COMMENT ON TABLE scout_schemas IS 'Team scouting forms. Owners, admins and delegated scouting leads manage forms; all members can read. Foreign keys protect forms with saved reports.';

DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('match_scout_entries','match_entries_lead_delete'),
    ('pit_scout_entries','pit_entries_lead_delete'),
    ('scout_sync_receipts','receipts_lead_delete')
  ) AS policies(table_name,policy_name) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',item.policy_name,item.table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO vantage_app USING(can_manage_scouting(org_id))',item.policy_name,item.table_name);
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('scout_assignments','assignments_coach_write'),
    ('org_value_formulas','formulas_coach_write')
  ) AS policies(table_name,policy_name) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',item.policy_name,item.table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO vantage_app USING(can_manage_scouting(org_id)) WITH CHECK(can_manage_scouting(org_id))',item.policy_name,item.table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS match_entries_author_update ON match_scout_entries;
CREATE POLICY match_entries_author_update ON match_scout_entries FOR UPDATE TO vantage_app
  USING(is_org_member(org_id) AND (scout_user_id=current_app_user_id() OR can_manage_scouting(org_id))) WITH CHECK(is_org_member(org_id));
DROP POLICY IF EXISTS pit_entries_author_update ON pit_scout_entries;
CREATE POLICY pit_entries_author_update ON pit_scout_entries FOR UPDATE TO vantage_app
  USING(is_org_member(org_id) AND (scout_user_id=current_app_user_id() OR can_manage_scouting(org_id))) WITH CHECK(is_org_member(org_id));
DROP POLICY IF EXISTS disagreements_coach_review ON scout_disagreements;
CREATE POLICY disagreements_coach_review ON scout_disagreements FOR UPDATE TO vantage_app USING(can_manage_scouting(org_id));
DROP POLICY IF EXISTS scout_field_policies_admin_write ON scout_field_policies;
CREATE POLICY scout_field_policies_admin_write ON scout_field_policies FOR ALL TO vantage_app
  USING(can_manage_scouting(org_id)) WITH CHECK(can_manage_scouting(org_id) AND updated_by=current_app_user_id());
DROP POLICY IF EXISTS free_scout_delete ON free_scout_reports;
CREATE POLICY free_scout_delete ON free_scout_reports FOR DELETE TO vantage_app
  USING(is_org_member(org_id) AND (scout_user_id=current_app_user_id() OR can_manage_scouting(org_id)));
DROP POLICY IF EXISTS scouting_sharing_write ON org_scouting_sharing;
CREATE POLICY scouting_sharing_write ON org_scouting_sharing FOR ALL TO vantage_app
  USING(can_manage_scouting(org_id)) WITH CHECK(can_manage_scouting(org_id) AND updated_by=current_app_user_id());

INSERT INTO org_role_profiles(org_id,key,name,description,base_role,capabilities,hub_access,created_by)
SELECT o.id,'scouting-lead','Scouting lead','Runs scouting forms, assignments, reports, sharing and data quality. No team-wide admin access.',
  'scout'::org_role,ARRAY['manage_scouting']::org_capability[],'{"competition":[]}'::jsonb,m.user_id
FROM organizations o JOIN LATERAL (SELECT user_id FROM memberships WHERE org_id=o.id AND role='owner' ORDER BY created_at LIMIT 1) m ON true
ON CONFLICT(org_id,key) DO NOTHING;

-- Preserve each policy's authorship, recipient, event and consent guards.
DROP POLICY IF EXISTS scout_pick_influence_admin_write ON scout_pick_influence;
CREATE POLICY scout_pick_influence_admin_write ON scout_pick_influence FOR ALL TO vantage_app
  USING (can_manage_scouting(org_id))
  WITH CHECK (can_manage_scouting(org_id) AND recorded_by=current_app_user_id());
DROP POLICY IF EXISTS scout_strategy_seats_admin_write ON scout_strategy_seats;
CREATE POLICY scout_strategy_seats_admin_write ON scout_strategy_seats FOR ALL TO vantage_app
  USING (can_manage_scouting(org_id))
  WITH CHECK (can_manage_scouting(org_id) AND assigned_by=current_app_user_id());
DROP POLICY IF EXISTS notifications_scouting_gap_insert ON notifications;
CREATE POLICY notifications_scouting_gap_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scouting_coverage_gap'
    AND org_id IS NOT NULL
    AND can_manage_scouting(org_id)
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=notifications.org_id AND m.user_id=notifications.user_id)
  );
DROP POLICY IF EXISTS scout_disagreement_audit_member_insert ON scout_disagreement_audit;
CREATE POLICY scout_disagreement_audit_member_insert ON scout_disagreement_audit FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND actor_user_id = current_app_user_id()
    AND can_manage_scouting(org_id)
  );
DROP POLICY IF EXISTS notifications_scouting_disagreement_insert ON notifications;
CREATE POLICY notifications_scouting_disagreement_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scouting_disagreement_resolved'
    AND org_id IS NOT NULL
    AND can_manage_scouting(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
        AND m.role IN ('owner', 'admin')
    )
  );
DROP POLICY IF EXISTS notifications_scout_pick_influence_insert ON notifications;
CREATE POLICY notifications_scout_pick_influence_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scout_pick_influence'
    AND org_id IS NOT NULL
    AND can_manage_scouting(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
DROP POLICY IF EXISTS notifications_scout_strategy_seat_insert ON notifications;
CREATE POLICY notifications_scout_strategy_seat_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scout_strategy_seat'
    AND org_id IS NOT NULL
    AND can_manage_scouting(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
DROP POLICY IF EXISTS scout_voice_org_settings_admin_write ON scout_voice_org_settings;
CREATE POLICY scout_voice_org_settings_admin_write ON scout_voice_org_settings FOR INSERT TO vantage_app
  WITH CHECK (can_manage_scouting(org_id) AND updated_by = current_app_user_id());
DROP POLICY IF EXISTS scout_voice_org_settings_admin_update ON scout_voice_org_settings;
CREATE POLICY scout_voice_org_settings_admin_update ON scout_voice_org_settings FOR UPDATE TO vantage_app
  USING (can_manage_scouting(org_id))
  WITH CHECK (can_manage_scouting(org_id));
DROP POLICY IF EXISTS scout_voice_org_settings_admin_delete ON scout_voice_org_settings;
CREATE POLICY scout_voice_org_settings_admin_delete ON scout_voice_org_settings FOR DELETE TO vantage_app
  USING (can_manage_scouting(org_id));
DROP POLICY IF EXISTS scout_voice_user_prefs_admin_read ON scout_voice_user_prefs;
CREATE POLICY scout_voice_user_prefs_admin_read ON scout_voice_user_prefs FOR SELECT TO vantage_app
  USING (can_manage_scouting(org_id));
DROP POLICY IF EXISTS scout_voice_notes_author_update ON scout_voice_notes;
CREATE POLICY scout_voice_notes_author_update ON scout_voice_notes FOR UPDATE TO vantage_app
  USING (created_by = current_app_user_id() OR can_manage_scouting(org_id))
  WITH CHECK (is_org_member(org_id));
DROP POLICY IF EXISTS scout_voice_notes_author_delete ON scout_voice_notes;
CREATE POLICY scout_voice_notes_author_delete ON scout_voice_notes FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR can_manage_scouting(org_id));
DROP POLICY IF EXISTS scout_accuracy_snapshots_coach_insert ON scout_accuracy_snapshots;
CREATE POLICY scout_accuracy_snapshots_coach_insert ON scout_accuracy_snapshots FOR INSERT TO vantage_app
  WITH CHECK (can_manage_scouting(org_id) AND computed_by = current_app_user_id());
DROP POLICY IF EXISTS scout_accuracy_snapshots_coach_update ON scout_accuracy_snapshots;
CREATE POLICY scout_accuracy_snapshots_coach_update ON scout_accuracy_snapshots FOR UPDATE TO vantage_app
  USING (can_manage_scouting(org_id))
  WITH CHECK (can_manage_scouting(org_id));
DROP POLICY IF EXISTS scout_accuracy_snapshots_coach_delete ON scout_accuracy_snapshots;
CREATE POLICY scout_accuracy_snapshots_coach_delete ON scout_accuracy_snapshots FOR DELETE TO vantage_app
  USING (can_manage_scouting(org_id));
DROP POLICY IF EXISTS scout_accuracy_promotions_coach_insert ON scout_accuracy_promotions;
CREATE POLICY scout_accuracy_promotions_coach_insert ON scout_accuracy_promotions FOR INSERT TO vantage_app
  WITH CHECK (can_manage_scouting(org_id) AND updated_by = current_app_user_id());
DROP POLICY IF EXISTS scout_accuracy_promotions_coach_update ON scout_accuracy_promotions;
CREATE POLICY scout_accuracy_promotions_coach_update ON scout_accuracy_promotions FOR UPDATE TO vantage_app
  USING (can_manage_scouting(org_id))
  WITH CHECK (can_manage_scouting(org_id));
DROP POLICY IF EXISTS scout_accuracy_promotions_coach_delete ON scout_accuracy_promotions;
CREATE POLICY scout_accuracy_promotions_coach_delete ON scout_accuracy_promotions FOR DELETE TO vantage_app
  USING (can_manage_scouting(org_id));

DROP POLICY IF EXISTS match_entries_scout_insert ON match_scout_entries;
CREATE POLICY match_entries_scout_insert ON match_scout_entries FOR INSERT TO vantage_app
  WITH CHECK((has_org_role(org_id,ARRAY['owner','admin','scout']::org_role[]) OR can_manage_scouting(org_id)) AND scout_user_id=current_app_user_id());
DROP POLICY IF EXISTS pit_entries_scout_insert ON pit_scout_entries;
CREATE POLICY pit_entries_scout_insert ON pit_scout_entries FOR INSERT TO vantage_app
  WITH CHECK((has_org_role(org_id,ARRAY['owner','admin','scout']::org_role[]) OR can_manage_scouting(org_id)) AND scout_user_id=current_app_user_id());
DROP POLICY IF EXISTS receipts_scout_insert ON scout_sync_receipts;
CREATE POLICY receipts_scout_insert ON scout_sync_receipts FOR INSERT TO vantage_app
  WITH CHECK(has_org_role(org_id,ARRAY['owner','admin','scout']::org_role[]) OR can_manage_scouting(org_id));
DROP POLICY IF EXISTS receipts_scout_update ON scout_sync_receipts;
CREATE POLICY receipts_scout_update ON scout_sync_receipts FOR UPDATE TO vantage_app
  USING(has_org_role(org_id,ARRAY['owner','admin','scout']::org_role[]) OR can_manage_scouting(org_id))
  WITH CHECK(has_org_role(org_id,ARRAY['owner','admin','scout']::org_role[]) OR can_manage_scouting(org_id));
DROP POLICY IF EXISTS context_admin_write ON org_active_context;
CREATE POLICY context_admin_write ON org_active_context FOR ALL TO vantage_app
  USING(has_org_capability(org_id,'manage_team_settings'::org_capability) OR can_manage_scouting(org_id))
  WITH CHECK(has_org_capability(org_id,'manage_team_settings'::org_capability) OR can_manage_scouting(org_id));

-- A scouting lead may create and select the team's own offseason event. Shared TBA events remain read-only.
DROP POLICY events_org_insert ON events_ref;
CREATE POLICY events_org_insert ON events_ref FOR INSERT TO vantage_app WITH CHECK (
  org_id IS NOT NULL AND can_manage_scouting(org_id)
  AND event_key ~ '^[0-9]{4}custom-[a-z0-9]{8}-[a-z0-9-]{1,40}$'
);
DROP POLICY events_org_update ON events_ref;
CREATE POLICY events_org_update ON events_ref FOR UPDATE TO vantage_app
  USING (org_id IS NOT NULL AND can_manage_scouting(org_id))
  WITH CHECK (org_id IS NOT NULL AND can_manage_scouting(org_id));
DROP POLICY events_org_delete ON events_ref;
CREATE POLICY events_org_delete ON events_ref FOR DELETE TO vantage_app
  USING (org_id IS NOT NULL AND can_manage_scouting(org_id));
