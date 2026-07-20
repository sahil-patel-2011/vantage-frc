-- CAD Change Impact Radar: snapshots tracked parameters (envelope dims, mount hole
-- patterns, mass, gear ratios) per Onshape part revision, diffs each release, and fans
-- out targeted "this changed, here's who it affects" notifications to subscribers.
-- Reads the existing cad_connections (0016_cad_workspace.sql) for the Onshape link;
-- owns its own new tables, prefixed cad_change_radar_.

CREATE TABLE cad_change_radar_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES cad_connections(id) ON DELETE SET NULL,
  part_key text NOT NULL,
  part_name text NOT NULL,
  revision text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  mass_kg numeric,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, part_key, revision)
);
CREATE INDEX cad_change_radar_snapshots_org_part_idx
  ON cad_change_radar_snapshots(org_id, part_key, captured_at DESC);

CREATE TABLE cad_change_radar_diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_key text NOT NULL,
  part_name text NOT NULL,
  from_snapshot_id uuid REFERENCES cad_change_radar_snapshots(id) ON DELETE SET NULL,
  to_snapshot_id uuid NOT NULL REFERENCES cad_change_radar_snapshots(id) ON DELETE CASCADE,
  from_revision text,
  to_revision text NOT NULL,
  changed_params jsonb NOT NULL DEFAULT '[]',
  severity text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'moderate', 'major')),
  ai_summary text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_change_radar_diffs_org_part_idx
  ON cad_change_radar_diffs(org_id, part_key, created_at DESC);

CREATE TABLE cad_change_radar_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  part_key text NOT NULL,
  subsystem text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id, part_key)
);
CREATE INDEX cad_change_radar_subscriptions_org_part_idx
  ON cad_change_radar_subscriptions(org_id, part_key);

CREATE TABLE cad_change_radar_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  diff_id uuid NOT NULL REFERENCES cad_change_radar_diffs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_change_radar_notifications_org_user_idx
  ON cad_change_radar_notifications(org_id, user_id, created_at DESC);

ALTER TABLE cad_change_radar_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE cad_change_radar_diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cad_change_radar_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cad_change_radar_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY cad_change_radar_snapshots_member_read ON cad_change_radar_snapshots FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_change_radar_snapshots_member_insert ON cad_change_radar_snapshots FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY cad_change_radar_snapshots_member_update ON cad_change_radar_snapshots FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cad_change_radar_snapshots_member_delete ON cad_change_radar_snapshots FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY cad_change_radar_diffs_member_read ON cad_change_radar_diffs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_change_radar_diffs_member_insert ON cad_change_radar_diffs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY cad_change_radar_diffs_member_update ON cad_change_radar_diffs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cad_change_radar_diffs_member_delete ON cad_change_radar_diffs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY cad_change_radar_subscriptions_member_read ON cad_change_radar_subscriptions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_change_radar_subscriptions_member_insert ON cad_change_radar_subscriptions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY cad_change_radar_subscriptions_member_update ON cad_change_radar_subscriptions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY cad_change_radar_subscriptions_member_delete ON cad_change_radar_subscriptions FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY cad_change_radar_notifications_member_read ON cad_change_radar_notifications FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_change_radar_notifications_member_insert ON cad_change_radar_notifications FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY cad_change_radar_notifications_member_update ON cad_change_radar_notifications FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY cad_change_radar_notifications_member_delete ON cad_change_radar_notifications FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  cad_change_radar_snapshots, cad_change_radar_diffs,
  cad_change_radar_subscriptions, cad_change_radar_notifications
  TO vantage_app, vantage_worker;
