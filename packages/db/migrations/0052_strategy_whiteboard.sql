-- Strategy Whiteboard.
-- Named plays drawn over a schematic FRC field: freehand/arrow strokes plus six
-- draggable robot tokens, stored as normalized coordinates so any screen can
-- re-render them. The drive coach's pre-match whiteboard, persisted per org.

CREATE TABLE whiteboard_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  match_key text REFERENCES matches_ref(match_key),
  description text NOT NULL DEFAULT '',
  -- [{ tool: 'pen'|'arrow', color: <palette key>, points: [[x,y], ...] }, ...]
  -- Coordinates are normalized to a 1000 x 500 field; validated in lib/whiteboard.
  strokes jsonb NOT NULL DEFAULT '[]',
  -- [{ id: 'r1'|... , alliance: 'red'|'blue', x, y }, ...] token positions.
  robots jsonb NOT NULL DEFAULT '[]',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whiteboard_plays_org_idx ON whiteboard_plays(org_id, updated_at DESC);

ALTER TABLE whiteboard_plays ENABLE ROW LEVEL SECURITY;

-- Plays are shared team artifacts: members read and edit; deleting is limited to
-- the creator or an owner/admin.
CREATE POLICY whiteboard_read ON whiteboard_plays FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY whiteboard_insert ON whiteboard_plays FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY whiteboard_update ON whiteboard_plays FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY whiteboard_delete ON whiteboard_plays FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON whiteboard_plays TO vantage_app, vantage_worker;
