-- Learning phase 2: persisted learning-mode preferences.
--
-- Phase 1 (0452_learning_predictions.sql) stored every "Call Your Shot" call, but
-- the learning-mode toggle itself lived only in localStorage — a student's choice
-- did not follow them across devices and could not vary per surface. This table
-- makes the toggle a per-member, per-surface org-scoped preference:
--
--   surface IS NULL  -> the member's default across every learning surface
--   surface = '...'  -> an explicit override for one calculator
--
-- Ownership is strict: a member manages ONLY their own rows. Owners/admins may
-- additionally SELECT the org's rows so the mentor foreman view can say
-- "learning mode is off for 4 students" — but they may NOT write another
-- member's preference. Scaffolding that fades must fade legibly, never be
-- imposed (or removed) silently by someone else.

CREATE TABLE learning_mode_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL means "my default on every surface"; otherwise one specific calculator.
  surface text CHECK (surface IN ('gearbox', 'power_budget', 'shooter_table')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE(org_id, user_id, surface) — expressed as two partial unique indexes
-- because a plain UNIQUE constraint treats NULL surfaces as distinct, which
-- would allow duplicate "member default" rows.
CREATE UNIQUE INDEX learning_mode_prefs_surface_uidx
  ON learning_mode_prefs(org_id, user_id, surface) WHERE surface IS NOT NULL;
CREATE UNIQUE INDEX learning_mode_prefs_default_uidx
  ON learning_mode_prefs(org_id, user_id) WHERE surface IS NULL;

ALTER TABLE learning_mode_prefs ENABLE ROW LEVEL SECURITY;

-- A member reads their own preference rows; owners/admins read the whole org's
-- (visibility only — so the foreman view can be honest about who has the gate off).
CREATE POLICY learning_mode_prefs_read ON learning_mode_prefs FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

-- Writes are self-only for every role: nobody sets another member's toggle.
CREATE POLICY learning_mode_prefs_insert_self ON learning_mode_prefs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY learning_mode_prefs_update_self ON learning_mode_prefs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY learning_mode_prefs_delete_self ON learning_mode_prefs FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON learning_mode_prefs TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_mode_prefs TO vantage_worker;
