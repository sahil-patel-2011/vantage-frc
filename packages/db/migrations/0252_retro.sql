-- Team Retrospective: structured start/stop/continue retro sessions with lightweight voting
-- and tracked action items, plus an auto-compiled season postmortem summarizing this org's
-- real decision/risk/incident/FMEA rows (packages/db/migrations/0101, 0092, 0121, 0153).
-- Org-scoped, collaborative, per-org RLS. All new tables, prefixed retro_.

CREATE TABLE retro_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  period_label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retro_sessions_org_season_idx ON retro_sessions(org_id, season_year, created_at DESC);

ALTER TABLE retro_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_sessions_member_read ON retro_sessions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY retro_sessions_member_insert ON retro_sessions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY retro_sessions_member_update ON retro_sessions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY retro_sessions_member_delete ON retro_sessions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON retro_sessions TO vantage_app, vantage_worker;

CREATE TABLE retro_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES retro_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('start', 'stop', 'continue')),
  content text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retro_items_org_session_idx ON retro_items(org_id, session_id, kind);

ALTER TABLE retro_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_items_member_read ON retro_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY retro_items_member_insert ON retro_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY retro_items_member_update ON retro_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY retro_items_member_delete ON retro_items FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON retro_items TO vantage_app, vantage_worker;

CREATE TABLE retro_item_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES retro_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id)
);
CREATE INDEX retro_item_votes_org_item_idx ON retro_item_votes(org_id, item_id);

ALTER TABLE retro_item_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_item_votes_member_read ON retro_item_votes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY retro_item_votes_member_insert ON retro_item_votes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY retro_item_votes_member_update ON retro_item_votes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY retro_item_votes_member_delete ON retro_item_votes FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON retro_item_votes TO vantage_app, vantage_worker;

CREATE TABLE retro_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES retro_sessions(id) ON DELETE CASCADE,
  title text NOT NULL,
  owner text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done')),
  due_on date,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retro_action_items_org_session_idx ON retro_action_items(org_id, session_id);

ALTER TABLE retro_action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_action_items_member_read ON retro_action_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY retro_action_items_member_insert ON retro_action_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY retro_action_items_member_update ON retro_action_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY retro_action_items_member_delete ON retro_action_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON retro_action_items TO vantage_app, vantage_worker;

CREATE TABLE retro_postmortems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  narrative text NOT NULL DEFAULT '',
  counts jsonb NOT NULL DEFAULT '{}',
  generated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retro_postmortems_org_season_idx ON retro_postmortems(org_id, season_year, created_at DESC);

ALTER TABLE retro_postmortems ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_postmortems_member_read ON retro_postmortems FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY retro_postmortems_member_insert ON retro_postmortems FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND generated_by = current_app_user_id());
CREATE POLICY retro_postmortems_member_update ON retro_postmortems FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY retro_postmortems_member_delete ON retro_postmortems FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON retro_postmortems TO vantage_app, vantage_worker;
