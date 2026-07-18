-- Scout training mode: practice-scouting attempts against real historical matches (matches_ref),
-- used to onboard new scouts before they scout live. Each attempt records a trainee's predicted
-- outcome for a completed historical match and a computed accuracy score against what happened.

CREATE TABLE scout_training_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_key text NOT NULL REFERENCES matches_ref(match_key) ON DELETE CASCADE,
  trainee_user_id uuid NOT NULL REFERENCES users(id),
  predicted_winner text NOT NULL CHECK (predicted_winner IN ('red', 'blue', 'tie')),
  predicted_red_score integer NOT NULL DEFAULT 0 CHECK (predicted_red_score >= 0),
  predicted_blue_score integer NOT NULL DEFAULT 0 CHECK (predicted_blue_score >= 0),
  notes text,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  accuracy_score double precision NOT NULL DEFAULT 0 CHECK (accuracy_score >= 0 AND accuracy_score <= 1),
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_training_attempts_org_idx ON scout_training_attempts(org_id, submitted_at DESC);
CREATE INDEX scout_training_attempts_trainee_idx ON scout_training_attempts(org_id, trainee_user_id, submitted_at DESC);

ALTER TABLE scout_training_attempts ENABLE ROW LEVEL SECURITY;

-- Any org member may read the shared practice log; inserts stamp the trainee.
CREATE POLICY scout_training_attempts_member_read ON scout_training_attempts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_training_attempts_member_insert ON scout_training_attempts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND trainee_user_id = current_app_user_id());
CREATE POLICY scout_training_attempts_member_update ON scout_training_attempts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_training_attempts_member_delete ON scout_training_attempts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_training_attempts TO vantage_app, vantage_worker;
