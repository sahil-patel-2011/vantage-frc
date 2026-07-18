-- Scouting trust and engagement layer. This keeps official-reference checks,
-- per-field source policy, scout accuracy, pick influence, and schema lineage
-- auditable instead of hiding them in derived UI state.

ALTER TABLE scout_schemas
  ADD COLUMN IF NOT EXISTS cloned_from_schema_id uuid REFERENCES scout_schemas(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS scout_field_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schema_id uuid NOT NULL REFERENCES scout_schemas(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  preferred_source text NOT NULL DEFAULT 'consensus'
    CHECK (preferred_source IN ('scout','tba','statbotics','consensus')),
  official_key text,
  team_indexed boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, schema_id, field_key)
);

CREATE TABLE IF NOT EXISTS scout_entry_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES match_scout_entries(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  scout_value jsonb,
  official_value jsonb,
  official_source text NOT NULL DEFAULT 'tba',
  status text NOT NULL CHECK (status IN ('match','conflict','unavailable','not_comparable')),
  detail text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, field_key, official_source)
);
CREATE INDEX IF NOT EXISTS scout_validations_org_status_idx
  ON scout_entry_validations(org_id, status, checked_at DESC);

CREATE TABLE IF NOT EXISTS scout_pick_influence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  pick_list_id uuid REFERENCES pick_lists(id) ON DELETE SET NULL,
  team_key text NOT NULL,
  entry_id uuid NOT NULL REFERENCES match_scout_entries(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, team_key, entry_id)
);
CREATE INDEX IF NOT EXISTS scout_pick_influence_scout_idx
  ON scout_pick_influence(entry_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS scout_strategy_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_on date NOT NULL,
  reason text NOT NULL DEFAULT '',
  assigned_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, user_id, meeting_on)
);

ALTER TABLE scout_field_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_entry_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_pick_influence ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_strategy_seats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scout_field_policies_read ON scout_field_policies;
DROP POLICY IF EXISTS scout_field_policies_admin_write ON scout_field_policies;
DROP POLICY IF EXISTS scout_entry_validations_read ON scout_entry_validations;
DROP POLICY IF EXISTS scout_entry_validations_member_write ON scout_entry_validations;
DROP POLICY IF EXISTS scout_pick_influence_read ON scout_pick_influence;
DROP POLICY IF EXISTS scout_pick_influence_admin_write ON scout_pick_influence;
DROP POLICY IF EXISTS scout_strategy_seats_read ON scout_strategy_seats;
DROP POLICY IF EXISTS scout_strategy_seats_admin_write ON scout_strategy_seats;

CREATE POLICY scout_field_policies_read ON scout_field_policies FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_field_policies_admin_write ON scout_field_policies FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by=current_app_user_id());
CREATE POLICY scout_entry_validations_read ON scout_entry_validations FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_entry_validations_member_write ON scout_entry_validations FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_pick_influence_read ON scout_pick_influence FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_pick_influence_admin_write ON scout_pick_influence FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND recorded_by=current_app_user_id());
CREATE POLICY scout_strategy_seats_read ON scout_strategy_seats FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_strategy_seats_admin_write ON scout_strategy_seats FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND assigned_by=current_app_user_id());

GRANT SELECT,INSERT,UPDATE,DELETE ON scout_field_policies,scout_entry_validations,
  scout_pick_influence,scout_strategy_seats TO vantage_app,vantage_worker;

DROP POLICY IF EXISTS notifications_scouting_gap_insert ON notifications;
CREATE POLICY notifications_scouting_gap_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scouting_coverage_gap'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=notifications.org_id AND m.user_id=notifications.user_id)
  );
