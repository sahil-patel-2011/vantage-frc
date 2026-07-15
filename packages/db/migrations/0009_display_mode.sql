DO $$ BEGIN CREATE ROLE vantage_display NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO vantage_display;
CREATE TABLE display_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,preset text NOT NULL CHECK(preset IN ('next_match','win_prediction','robot_readiness','event_command','scouting_coverage','custom')),
  widgets jsonb NOT NULL DEFAULT '[]',created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,name)
);
CREATE TABLE display_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES display_boards(id) ON DELETE CASCADE,token_hash text UNIQUE NOT NULL,label text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),expires_at timestamptz,revoked_at timestamptz,last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX display_tokens_board_idx ON display_tokens(board_id);
ALTER TABLE display_boards ENABLE ROW LEVEL SECURITY;ALTER TABLE display_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY display_boards_member_read ON display_boards FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY display_boards_admin_write ON display_boards FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND created_by=current_app_user_id());
CREATE POLICY display_tokens_admin ON display_tokens FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND created_by=current_app_user_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON display_boards,display_tokens TO vantage_app,vantage_worker;

CREATE OR REPLACE FUNCTION get_display_snapshot(raw_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE token_row display_tokens%ROWTYPE; board_row display_boards%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO token_row FROM display_tokens WHERE token_hash=encode(digest(raw_token,'sha256'),'hex')
    AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
  IF token_row.id IS NULL THEN RAISE EXCEPTION 'Display token is invalid or expired'; END IF;
  SELECT * INTO board_row FROM display_boards WHERE id=token_row.board_id AND org_id=token_row.org_id;
  UPDATE display_tokens SET last_used_at=now() WHERE id=token_row.id;
  SELECT jsonb_build_object(
    'board',jsonb_build_object('id',board_row.id,'name',board_row.name,'preset',board_row.preset,'widgets',board_row.widgets),
    'organization',jsonb_build_object('name',o.name,'teamNumber',o.team_number),
    'activeEvent',jsonb_build_object('eventKey',c.active_event_key,'name',e.name),
    'nextMatch',(SELECT jsonb_build_object('matchKey',m.match_key,'compLevel',m.comp_level,'matchNumber',m.match_number,
      'scheduledTime',COALESCE(m.predicted_time,m.event_time),'redAlliance',m.red_alliance,'blueAlliance',m.blue_alliance)
      FROM matches_ref m WHERE m.event_key=c.active_event_key AND COALESCE(m.actual_time,m.predicted_time,m.event_time)>now()
      ORDER BY COALESCE(m.actual_time,m.predicted_time,m.event_time) LIMIT 1),
    'scouting',jsonb_build_object(
      'assignments',(SELECT count(*) FROM scout_assignments a WHERE a.org_id=o.id AND a.event_key=c.active_event_key),
      'reports',(SELECT count(*) FROM match_scout_entries s WHERE s.org_id=o.id AND s.event_key=c.active_event_key),
      'openDisagreements',(SELECT count(*) FROM scout_disagreements d WHERE d.org_id=o.id AND d.event_key=c.active_event_key AND d.status='open')
    ),
    'updatedAt',now()
  ) INTO result FROM organizations o LEFT JOIN org_active_context c ON c.org_id=o.id
    LEFT JOIN events_ref e ON e.event_key=c.active_event_key WHERE o.id=board_row.org_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION get_display_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_display_snapshot(text) TO vantage_display;
