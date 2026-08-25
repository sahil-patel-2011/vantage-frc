-- "Call Your Shot" learning ledger.
--
-- On the engineering calculators (/gearbox, /power-budget, /shooter-table) a
-- student-tier member calls the computed answer before the calculator reveals it.
-- Every committed call — and every deliberate skip — lands here as one append-only
-- row: the inputs they were looking at, what they predicted, what the existing pure
-- functions actually computed, and how close they were.
--
-- Skips are recorded, never blocked: deadline mode is allowed but never free, so a
-- skipped call is mentor-visible debt rather than a lost lesson.
--
-- Reads: a member sees their own calls; owners/admins see the whole org's, because
-- the point of the ledger is a mentor noticing who is struggling before the mentor
-- who knew that subsystem graduates.

CREATE TABLE learning_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface text NOT NULL CHECK (surface IN ('gearbox', 'power_budget', 'shooter_table')),
  -- The calculator inputs the student was looking at when they called it.
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { fieldKey: number } — what they committed to before the reveal.
  predicted jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { fieldKey: number } — what the pure compute functions produced.
  actual jsonb NOT NULL DEFAULT '{}'::jsonb,
  closeness text CHECK (closeness IN ('spot-on', 'close', 'off')),
  skipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A row is either a graded call or an honest skip; never an ungraded call.
  CONSTRAINT learning_predictions_graded_or_skipped CHECK (skipped OR closeness IS NOT NULL)
);

-- The student's own "last 5 calls on this surface" trend.
CREATE INDEX learning_predictions_user_surface_idx
  ON learning_predictions(org_id, user_id, surface, created_at DESC);
-- The mentor's "who is struggling" read across the org.
CREATE INDEX learning_predictions_org_surface_idx
  ON learning_predictions(org_id, surface, created_at DESC);

ALTER TABLE learning_predictions ENABLE ROW LEVEL SECURITY;

-- Members read their own calls; owners/admins read every call in their org.
CREATE POLICY learning_predictions_read ON learning_predictions FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

-- You may only commit your own calls, and only inside an org you belong to.
CREATE POLICY learning_predictions_insert_self ON learning_predictions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

-- No UPDATE/DELETE grant for the app role: a call is falsifiable only if it
-- cannot be edited after the reveal. Retention/cleanup runs as the worker.
GRANT SELECT, INSERT ON learning_predictions TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_predictions TO vantage_worker;
