-- Robot Blueprint (digital twin).
-- Extends robot_subsystems from 0104_robot_subsystems.sql with CAD/code/strategy
-- links and ops join keys. The /robot page and robot_blueprint AI insight render
-- readiness per subsystem. Idempotent: 0104 already created the table + RLS.

-- Blueprint inserts omit season_year; keep the 0104 NOT NULL column via default.
ALTER TABLE robot_subsystems
  ALTER COLUMN season_year SET DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::int;

ALTER TABLE robot_subsystems
  ADD COLUMN IF NOT EXISTS robot_label text NOT NULL DEFAULT 'competition',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'concept',
  ADD COLUMN IF NOT EXISTS cad_url text,
  ADD COLUMN IF NOT EXISTS code_ref text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS priority_id uuid REFERENCES design_priorities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS practice_action text,
  ADD COLUMN IF NOT EXISTS bom_subsystem text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'robot_subsystems_status_check'
      AND conrelid = 'public.robot_subsystems'::regclass
  ) THEN
    ALTER TABLE robot_subsystems
      ADD CONSTRAINT robot_subsystems_status_check
      CHECK (status IN ('concept', 'designing', 'prototyping', 'built', 'tested', 'competition_ready'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS robot_subsystems_org_idx
  ON robot_subsystems(org_id, robot_label, sort_order);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'robot_subsystems_org_id_robot_label_name_key'
      AND conrelid = 'public.robot_subsystems'::regclass
  ) THEN
    ALTER TABLE robot_subsystems
      ADD CONSTRAINT robot_subsystems_org_id_robot_label_name_key
      UNIQUE (org_id, robot_label, name);
  END IF;
END $$;

ALTER TABLE robot_subsystems ENABLE ROW LEVEL SECURITY;

-- Shared team artifact: members read/edit; delete limited to creator or owner/admin.
DROP POLICY IF EXISTS robot_subsystems_read ON robot_subsystems;
DROP POLICY IF EXISTS robot_subsystems_insert ON robot_subsystems;
DROP POLICY IF EXISTS robot_subsystems_update ON robot_subsystems;
DROP POLICY IF EXISTS robot_subsystems_delete ON robot_subsystems;
CREATE POLICY robot_subsystems_read ON robot_subsystems FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY robot_subsystems_insert ON robot_subsystems FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY robot_subsystems_update ON robot_subsystems FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY robot_subsystems_delete ON robot_subsystems FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON robot_subsystems TO vantage_app, vantage_worker;
