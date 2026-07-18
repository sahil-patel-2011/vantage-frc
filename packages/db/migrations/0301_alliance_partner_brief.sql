-- Alliance-partner brief: once alliance selection is finalized on an alliance board, a
-- generated brief on the actual partners (not hypothetical picks) — role, strengths, evidence —
-- grounded in TBA/Statbotics event metrics (team_event_metrics) and this org's own scouting
-- (match_scout_entries, pit_scout_entries). Stored per org/event/alliance seed so it can be
-- regenerated as more scouting data comes in without losing history of prior briefs.
--
-- NOTE: the originally assigned migration number 0260 was already taken by a concurrent
-- session's 0260_rls_tenancy_idor.sql by the time this file was written; 0262 is the next
-- free number (0261_scout_voice_notes.sql already exists) per the append-only migration rule.

CREATE TABLE alliance_partner_brief_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  alliance_board_id uuid REFERENCES alliance_boards(id) ON DELETE SET NULL,
  alliance_seed integer NOT NULL CHECK (alliance_seed > 0),
  our_team_key text NOT NULL,
  partner_team_keys text[] NOT NULL DEFAULT '{}',
  partners jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_request_id text,
  generated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, alliance_seed)
);
CREATE INDEX alliance_partner_brief_briefs_org_event_idx
  ON alliance_partner_brief_briefs(org_id, event_key, updated_at DESC);

ALTER TABLE alliance_partner_brief_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY alliance_partner_brief_briefs_member_read ON alliance_partner_brief_briefs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY alliance_partner_brief_briefs_member_insert ON alliance_partner_brief_briefs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND generated_by = current_app_user_id());
CREATE POLICY alliance_partner_brief_briefs_member_update ON alliance_partner_brief_briefs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY alliance_partner_brief_briefs_member_delete ON alliance_partner_brief_briefs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_partner_brief_briefs TO vantage_app, vantage_worker;
