-- A team lead really signs off the guided-track steps software cannot check.
--
-- Guided tracks (apps/web/lib/guided) check most steps by reading the student's Onshape document,
-- pasted build output or GitHub. A few steps cannot be read by software (used the band saw safely,
-- walked a lead through the wiring), and until now the student's own button marked those done.
-- Now the student asks, and an owner or admin approves or declines; the step counts as done only
-- after an approval. Nobody approves their own request.
--
-- Progress stays in cad_learn_progress (the student's own rows); an approved sign-off is read
-- alongside it, so a lead never writes into another member's progress rows.

CREATE TABLE IF NOT EXISTS guided_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- guided:<track>:<step>, the same id cad_learn_progress uses for guided steps.
  lesson_id text NOT NULL CHECK (lesson_id ~ '^guided:[a-z0-9-]+:[a-z0-9-]+$'),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'declined')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  UNIQUE (org_id, user_id, lesson_id),
  CHECK ((status = 'requested') = (decided_at IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> user_id)
);
CREATE INDEX IF NOT EXISTS guided_signoffs_pending_idx ON guided_signoffs (org_id, requested_at) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS guided_signoffs_user_idx ON guided_signoffs (org_id, user_id);

ALTER TABLE guided_signoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guided_signoffs_read ON guided_signoffs;
CREATE POLICY guided_signoffs_read ON guided_signoffs FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  );

-- A student asks (or asks again after a decline) for their own step only.
DROP POLICY IF EXISTS guided_signoffs_self_request ON guided_signoffs;
CREATE POLICY guided_signoffs_self_request ON guided_signoffs FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id) AND user_id = current_app_user_id()
    AND status = 'requested' AND decided_by IS NULL AND decided_at IS NULL
  );
DROP POLICY IF EXISTS guided_signoffs_self_rerequest ON guided_signoffs;
CREATE POLICY guided_signoffs_self_rerequest ON guided_signoffs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (
    is_org_member(org_id) AND user_id = current_app_user_id()
    AND status = 'requested' AND decided_by IS NULL AND decided_at IS NULL
  );

-- An owner or admin decides, never on their own request.
DROP POLICY IF EXISTS guided_signoffs_lead_decide ON guided_signoffs;
CREATE POLICY guided_signoffs_lead_decide ON guided_signoffs FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]) AND user_id <> current_app_user_id())
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]) AND user_id <> current_app_user_id()
    AND (status = 'requested' OR decided_by = current_app_user_id())
  );

-- A student can withdraw a request or redo a signed-off step (which only costs them the
-- sign-off); a lead can clear any.
DROP POLICY IF EXISTS guided_signoffs_delete ON guided_signoffs;
CREATE POLICY guided_signoffs_delete ON guided_signoffs FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON guided_signoffs TO vantage_app, vantage_worker;

SELECT install_view_only_guards();
