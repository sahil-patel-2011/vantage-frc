-- Scout accuracy scoring: post-event, each scout's match-entry numeric fields (payload.autoPoints /
-- teleopPoints / endgamePoints / totalPoints) are scored against the cached TBA `score_breakdown`
-- (matches_ref, alliance-level ground truth). Snapshots persist a computed leaderboard (what a
-- post-event cron would write); promotions persist the coach's pick-desk rotation decision derived
-- from the ranked leaderboard. Distinct from `scout_crossval_runs` (0198-era per-field agree/conflict
-- audit trail) — this feature aggregates accuracy PER SCOUT into a ranked leaderboard + rotation call.

CREATE TABLE IF NOT EXISTS scout_accuracy_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  season_year integer NOT NULL,
  entries_scored integer NOT NULL DEFAULT 0 CHECK (entries_scored >= 0),
  scouts_scored integer NOT NULL DEFAULT 0 CHECK (scouts_scored >= 0),
  avg_accuracy_score double precision NOT NULL DEFAULT 0,
  -- Ranked per-scout leaderboard at compute time: [{ scoutUserId, scoutName, entriesScored,
  -- accurateEntries, avgAbsErrorPct, accuracyScore, rank, suggestedPromote }, ...]
  scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_by uuid NOT NULL REFERENCES users(id),
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scout_accuracy_snapshots_org_event_idx
  ON scout_accuracy_snapshots(org_id, event_key, computed_at DESC);

CREATE TABLE IF NOT EXISTS scout_accuracy_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  scout_user_id uuid NOT NULL REFERENCES users(id),
  promoted boolean NOT NULL DEFAULT true,
  note text,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, scout_user_id)
);
CREATE INDEX IF NOT EXISTS scout_accuracy_promotions_org_event_idx
  ON scout_accuracy_promotions(org_id, event_key);

ALTER TABLE scout_accuracy_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_accuracy_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scout_accuracy_snapshots_member_read ON scout_accuracy_snapshots;
DROP POLICY IF EXISTS scout_accuracy_snapshots_coach_insert ON scout_accuracy_snapshots;
DROP POLICY IF EXISTS scout_accuracy_snapshots_coach_update ON scout_accuracy_snapshots;
DROP POLICY IF EXISTS scout_accuracy_snapshots_coach_delete ON scout_accuracy_snapshots;
CREATE POLICY scout_accuracy_snapshots_member_read ON scout_accuracy_snapshots FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_accuracy_snapshots_coach_insert ON scout_accuracy_snapshots FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND computed_by = current_app_user_id());
CREATE POLICY scout_accuracy_snapshots_coach_update ON scout_accuracy_snapshots FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_accuracy_snapshots_coach_delete ON scout_accuracy_snapshots FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

DROP POLICY IF EXISTS scout_accuracy_promotions_member_read ON scout_accuracy_promotions;
DROP POLICY IF EXISTS scout_accuracy_promotions_coach_insert ON scout_accuracy_promotions;
DROP POLICY IF EXISTS scout_accuracy_promotions_coach_update ON scout_accuracy_promotions;
DROP POLICY IF EXISTS scout_accuracy_promotions_coach_delete ON scout_accuracy_promotions;
CREATE POLICY scout_accuracy_promotions_member_read ON scout_accuracy_promotions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_accuracy_promotions_coach_insert ON scout_accuracy_promotions FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by = current_app_user_id());
CREATE POLICY scout_accuracy_promotions_coach_update ON scout_accuracy_promotions FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_accuracy_promotions_coach_delete ON scout_accuracy_promotions FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
GRANT SELECT, INSERT, UPDATE, DELETE ON scout_accuracy_snapshots TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON scout_accuracy_promotions TO vantage_app, vantage_worker;
