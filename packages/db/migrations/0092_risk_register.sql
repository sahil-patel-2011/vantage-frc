-- Risk Register (FMEA-lite): season risks scored by likelihood × impact, with a mitigation,
-- owner, and status tracked to closure. The app derives severity, a 5×5 matrix, and a
-- prioritized risk profile. Org-scoped, collaborative, per-org RLS.

CREATE TABLE risk_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('technical','schedule','funding','logistics','safety','people','other')),
  likelihood integer NOT NULL DEFAULT 3 CHECK (likelihood BETWEEN 1 AND 5),
  impact integer NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','mitigating','monitoring','accepted','closed')),
  mitigation text,
  owner text,
  due_on date,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risk_register_org_season_idx ON risk_register(org_id, season_year);

ALTER TABLE risk_register ENABLE ROW LEVEL SECURITY;

CREATE POLICY risk_register_member_read ON risk_register FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY risk_register_member_insert ON risk_register FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY risk_register_member_update ON risk_register FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY risk_register_member_delete ON risk_register FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON risk_register TO vantage_app, vantage_worker;
