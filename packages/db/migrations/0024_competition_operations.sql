CREATE TABLE robot_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text REFERENCES events_ref(event_key),
  match_key text REFERENCES matches_ref(match_key),
  robot_label text NOT NULL DEFAULT 'competition',
  subsystem text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('minor','degraded','disabled','safety')),
  symptoms text NOT NULL,
  cause text,
  resolution text,
  downtime_seconds integer CHECK (downtime_seconds IS NULL OR downtime_seconds >= 0),
  source_refs jsonb NOT NULL DEFAULT '[]',
  occurred_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX robot_failures_org_occurred_idx ON robot_failures(org_id, occurred_at DESC);

CREATE TABLE maintenance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  robot_label text NOT NULL DEFAULT 'competition',
  subsystem text NOT NULL,
  task text NOT NULL,
  interval_rule jsonb NOT NULL DEFAULT '{}',
  due_at timestamptz,
  due_cycles integer CHECK (due_cycles IS NULL OR due_cycles >= 0),
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batteries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_tag text NOT NULL,
  acquired_at date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','service','retired')),
  cycle_count integer NOT NULL DEFAULT 0 CHECK (cycle_count >= 0),
  retirement_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, asset_tag)
);
CREATE TABLE battery_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  battery_id uuid NOT NULL REFERENCES batteries(id) ON DELETE CASCADE,
  measured_at timestamptz NOT NULL,
  voltage double precision CHECK (voltage IS NULL OR voltage >= 0),
  internal_resistance_milliohms double precision CHECK (internal_resistance_milliohms IS NULL OR internal_resistance_milliohms >= 0),
  charger_cycles integer CHECK (charger_cycles IS NULL OR charger_cycles >= 0),
  source text NOT NULL DEFAULT 'manual',
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE training_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  status text NOT NULL CHECK (status IN ('assigned','in_progress','completed','expired')),
  evidence jsonb NOT NULL DEFAULT '{}',
  completed_at timestamptz,
  expires_at timestamptz,
  assigned_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE robot_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE batteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE battery_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY failures_member ON robot_failures FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY maintenance_member_read ON maintenance_items FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY maintenance_admin_write ON maintenance_items FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY batteries_member ON batteries FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY readings_member ON battery_readings FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY training_self_read ON training_records FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));
CREATE POLICY training_admin_write ON training_records FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON robot_failures, maintenance_items, batteries,
  battery_readings, training_records TO vantage_app, vantage_worker;
