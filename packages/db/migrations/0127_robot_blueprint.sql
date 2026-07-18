-- Robot Blueprint (digital twin).
-- One registry of the robot's subsystems, each linking the domains that describe it:
-- CAD (model URL), CODE (repo/class ref), STRATEGY (kickoff design priority), plus
-- live operational joins read from existing tables (BOM coverage, practice reps,
-- failures, maintenance). The /robot page and the robot_blueprint AI insight render
-- readiness per subsystem and for the robot as a whole.

CREATE TABLE robot_subsystems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  robot_label text NOT NULL DEFAULT 'competition',
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'concept'
    CHECK (status IN ('concept', 'designing', 'prototyping', 'built', 'tested', 'competition_ready')),
  -- CAD model link (Onshape / Fusion / any https URL); validated app-side.
  cad_url text,
  -- Code reference, e.g. "src/main/java/frc/robot/subsystems/Drivetrain.java".
  code_ref text NOT NULL DEFAULT '',
  -- Strategy link: which kickoff design priority this subsystem serves.
  priority_id uuid REFERENCES design_priorities(id) ON DELETE SET NULL,
  -- Exact driver_cycles.action label that exercises this subsystem in practice.
  practice_action text,
  -- bom_entries.subsystem key; empty means "use name".
  bom_subsystem text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, robot_label, name)
);
CREATE INDEX robot_subsystems_org_idx ON robot_subsystems(org_id, robot_label, sort_order);

ALTER TABLE robot_subsystems ENABLE ROW LEVEL SECURITY;

-- The blueprint is a shared team artifact: members read and edit; deleting is
-- limited to the creator or an owner/admin.
CREATE POLICY robot_subsystems_read ON robot_subsystems FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY robot_subsystems_insert ON robot_subsystems FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY robot_subsystems_update ON robot_subsystems FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY robot_subsystems_delete ON robot_subsystems FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON robot_subsystems TO vantage_app, vantage_worker;
