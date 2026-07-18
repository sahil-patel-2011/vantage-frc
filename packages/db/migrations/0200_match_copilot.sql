-- Match Copilot: between-matches copilot briefs. Stores the generated 60-sec
-- brief (3 prioritized do-this callouts fusing opponent scouting/EPA, our
-- stored strategy plan, open FMEA risks, and battery fleet health) for the
-- next match so it can be replayed / audited without re-running the model.

CREATE TABLE match_copilot_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_key text NOT NULL REFERENCES matches_ref(match_key) ON DELETE CASCADE,
  alliance text NOT NULL CHECK (alliance IN ('red', 'blue')),
  callouts jsonb NOT NULL DEFAULT '[]',
  generated_by text NOT NULL DEFAULT 'local' CHECK (generated_by IN ('ai', 'local')),
  ai_run_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_copilot_briefs_org_match_idx
  ON match_copilot_briefs(org_id, match_key, created_at DESC);

ALTER TABLE match_copilot_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_copilot_briefs_member_read ON match_copilot_briefs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY match_copilot_briefs_member_insert ON match_copilot_briefs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY match_copilot_briefs_member_update ON match_copilot_briefs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY match_copilot_briefs_member_delete ON match_copilot_briefs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON match_copilot_briefs TO vantage_app, vantage_worker;
