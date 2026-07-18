-- Onboarding Buddy: auto-pair a new member with a tenured buddy and track a first-week plan.
-- Pairings link a recently-joined member (new_member_id) to a more-tenured member (buddy_id);
-- plan items are the deterministic first-week checklist generated for that pairing.

CREATE TABLE onboarding_buddy_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  new_member_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buddy_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  notes text,
  paired_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_buddy_pairings_distinct CHECK (new_member_id <> buddy_id)
);
CREATE INDEX onboarding_buddy_pairings_org_idx ON onboarding_buddy_pairings(org_id, status, paired_at DESC);
CREATE UNIQUE INDEX onboarding_buddy_pairings_active_member_idx
  ON onboarding_buddy_pairings(org_id, new_member_id) WHERE status = 'active';

ALTER TABLE onboarding_buddy_pairings ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_buddy_pairings_member_read ON onboarding_buddy_pairings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY onboarding_buddy_pairings_member_insert ON onboarding_buddy_pairings FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY onboarding_buddy_pairings_member_update ON onboarding_buddy_pairings FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY onboarding_buddy_pairings_member_delete ON onboarding_buddy_pairings FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_buddy_pairings TO vantage_app, vantage_worker;

CREATE TABLE onboarding_buddy_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pairing_id uuid NOT NULL REFERENCES onboarding_buddy_pairings(id) ON DELETE CASCADE,
  day_offset integer NOT NULL DEFAULT 0 CHECK (day_offset >= 0),
  sequence integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_buddy_plan_items_pairing_idx
  ON onboarding_buddy_plan_items(org_id, pairing_id, day_offset, sequence);

ALTER TABLE onboarding_buddy_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_buddy_plan_items_member_read ON onboarding_buddy_plan_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY onboarding_buddy_plan_items_member_insert ON onboarding_buddy_plan_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY onboarding_buddy_plan_items_member_update ON onboarding_buddy_plan_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY onboarding_buddy_plan_items_member_delete ON onboarding_buddy_plan_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_buddy_plan_items TO vantage_app, vantage_worker;
