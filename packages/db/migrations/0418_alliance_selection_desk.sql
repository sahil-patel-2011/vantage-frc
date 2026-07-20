-- Alliance Selection Desk 2.0: live pick board with structured slots, scout evidence
-- attachments, TBA conflict flags (computed in app from team_event_metrics), and
-- drive-team export snapshots. Distinct from alliance_boards (jsonb draft state + share
-- tokens), alliance_sim (endgame role capacity), and picklist-collab (ranked lists).

CREATE TABLE alliance_selection_desk_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'live', 'locked')),
  notes text NOT NULL DEFAULT '',
  linked_alliance_board_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alliance_selection_desk_sessions_org_event_idx
  ON alliance_selection_desk_sessions(org_id, event_key, updated_at DESC);

CREATE TABLE alliance_selection_desk_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES alliance_selection_desk_sessions(id) ON DELETE CASCADE,
  alliance_seed integer NOT NULL CHECK (alliance_seed BETWEEN 1 AND 8),
  pick_slot text NOT NULL CHECK (pick_slot IN ('captain', 'first', 'second')),
  team_key text,
  rationale text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, alliance_seed, pick_slot)
);
CREATE INDEX alliance_selection_desk_slots_org_session_idx
  ON alliance_selection_desk_slots(org_id, session_id, alliance_seed, sort_order);

CREATE TABLE alliance_selection_desk_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES alliance_selection_desk_sessions(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES alliance_selection_desk_slots(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('match_scout', 'pit_scout', 'note')),
  match_scout_entry_id uuid,
  pit_scout_entry_id uuid,
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source_kind = 'match_scout' AND match_scout_entry_id IS NOT NULL AND pit_scout_entry_id IS NULL)
    OR (source_kind = 'pit_scout' AND pit_scout_entry_id IS NOT NULL AND match_scout_entry_id IS NULL)
    OR (source_kind = 'note' AND match_scout_entry_id IS NULL AND pit_scout_entry_id IS NULL AND char_length(trim(note)) > 0)
  )
);
CREATE INDEX alliance_selection_desk_evidence_slot_idx
  ON alliance_selection_desk_evidence(org_id, slot_id, created_at DESC);

CREATE TABLE alliance_selection_desk_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES alliance_selection_desk_sessions(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alliance_selection_desk_exports_org_session_idx
  ON alliance_selection_desk_exports(org_id, session_id, created_at DESC);

ALTER TABLE alliance_selection_desk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliance_selection_desk_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliance_selection_desk_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliance_selection_desk_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY alliance_selection_desk_sessions_member_read ON alliance_selection_desk_sessions
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY alliance_selection_desk_sessions_member_insert ON alliance_selection_desk_sessions
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY alliance_selection_desk_sessions_member_update ON alliance_selection_desk_sessions
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY alliance_selection_desk_sessions_member_delete ON alliance_selection_desk_sessions
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

CREATE POLICY alliance_selection_desk_slots_member_read ON alliance_selection_desk_slots
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY alliance_selection_desk_slots_member_insert ON alliance_selection_desk_slots
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id));
CREATE POLICY alliance_selection_desk_slots_member_update ON alliance_selection_desk_slots
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY alliance_selection_desk_slots_member_delete ON alliance_selection_desk_slots
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

CREATE POLICY alliance_selection_desk_evidence_member_read ON alliance_selection_desk_evidence
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY alliance_selection_desk_evidence_member_insert ON alliance_selection_desk_evidence
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY alliance_selection_desk_evidence_member_update ON alliance_selection_desk_evidence
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY alliance_selection_desk_evidence_member_delete ON alliance_selection_desk_evidence
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

CREATE POLICY alliance_selection_desk_exports_member_read ON alliance_selection_desk_exports
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY alliance_selection_desk_exports_member_insert ON alliance_selection_desk_exports
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY alliance_selection_desk_exports_member_delete ON alliance_selection_desk_exports
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_selection_desk_sessions TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_selection_desk_slots TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_selection_desk_evidence TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_selection_desk_exports TO vantage_app, vantage_worker;
