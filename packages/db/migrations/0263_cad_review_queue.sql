-- CAD Review Queue: checkpoint review queue for CAD parts/assemblies with reviewer
-- sign-offs required before a design is released to manufacture.

CREATE TABLE cad_review_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_name text NOT NULL,
  description text,
  checkpoint text NOT NULL DEFAULT 'design_review'
    CHECK (checkpoint IN ('design_review','fit_check','manufacturing_ready')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','changes_requested','approved','released')),
  cad_link text,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  submitted_by uuid NOT NULL REFERENCES users(id),
  required_signoffs integer NOT NULL DEFAULT 1 CHECK (required_signoffs >= 1),
  season_year integer NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_review_queue_items_org_season_idx
  ON cad_review_queue_items(org_id, season_year, created_at DESC);

ALTER TABLE cad_review_queue_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY cad_review_queue_items_member_read ON cad_review_queue_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_review_queue_items_member_insert ON cad_review_queue_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND submitted_by = current_app_user_id());
CREATE POLICY cad_review_queue_items_member_update ON cad_review_queue_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cad_review_queue_items_member_delete ON cad_review_queue_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON cad_review_queue_items TO vantage_app, vantage_worker;

CREATE TABLE cad_review_queue_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES cad_review_queue_items(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('approved','changes_requested')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_review_queue_signoffs_item_idx
  ON cad_review_queue_signoffs(item_id, created_at DESC);

ALTER TABLE cad_review_queue_signoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY cad_review_queue_signoffs_member_read ON cad_review_queue_signoffs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_review_queue_signoffs_member_insert ON cad_review_queue_signoffs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND reviewer_id = current_app_user_id());
CREATE POLICY cad_review_queue_signoffs_member_update ON cad_review_queue_signoffs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cad_review_queue_signoffs_member_delete ON cad_review_queue_signoffs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON cad_review_queue_signoffs TO vantage_app, vantage_worker;
