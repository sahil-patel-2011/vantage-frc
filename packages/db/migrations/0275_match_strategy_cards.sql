-- Match Strategy Cards: printable per-match strategy sheets for the drive team. Distinct from
-- 0023 prediction/strategy compute output (that's the win/loss analytics engine) — this is the
-- org-authored, editable game plan (roles, auto assignment, defense focus, key threats) that a
-- team fills in and prints ahead of a scheduled match at their active event.

CREATE TABLE match_strategy_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_key text NOT NULL REFERENCES matches_ref(match_key) ON DELETE CASCADE,
  event_key text NOT NULL,
  game_plan text,
  auto_assignment text,
  defense_focus text,
  key_threats text,
  driver_notes text,
  role_assignments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, match_key)
);
CREATE INDEX match_strategy_cards_org_event_idx
  ON match_strategy_cards(org_id, event_key);

ALTER TABLE match_strategy_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_strategy_cards_member_read ON match_strategy_cards FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY match_strategy_cards_member_insert ON match_strategy_cards FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY match_strategy_cards_member_update ON match_strategy_cards FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY match_strategy_cards_member_delete ON match_strategy_cards FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON match_strategy_cards TO vantage_app, vantage_worker;
