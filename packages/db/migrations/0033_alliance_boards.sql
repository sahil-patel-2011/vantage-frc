-- Alliance selection / draft-day boards with mentor share links.
CREATE TABLE alliance_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  name text NOT NULL,
  pick_list_id uuid REFERENCES pick_lists(id) ON DELETE SET NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, name)
);

CREATE INDEX alliance_boards_org_event_idx ON alliance_boards(org_id, event_key, updated_at DESC);

CREATE TABLE alliance_board_share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES alliance_boards(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alliance_board_share_tokens_board_idx
  ON alliance_board_share_tokens(board_id, created_at DESC);

ALTER TABLE alliance_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliance_board_share_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY alliance_boards_member_read ON alliance_boards FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY alliance_boards_coach_write ON alliance_boards FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY alliance_board_tokens_admin ON alliance_board_share_tokens FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_boards, alliance_board_share_tokens TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_boards, alliance_board_share_tokens TO vantage_worker;

CREATE OR REPLACE FUNCTION get_alliance_board_snapshot(raw_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t alliance_board_share_tokens%ROWTYPE;
  board alliance_boards%ROWTYPE;
  event_name text;
  result jsonb;
BEGIN
  SELECT * INTO t
  FROM alliance_board_share_tokens
  WHERE token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    AND revoked_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF t.id IS NULL THEN
    RAISE EXCEPTION 'Alliance board link is invalid or expired';
  END IF;

  UPDATE alliance_board_share_tokens
  SET last_used_at = now()
  WHERE id = t.id;

  SELECT * INTO board FROM alliance_boards WHERE id = t.board_id;
  IF board.id IS NULL THEN
    RAISE EXCEPTION 'Alliance board not found';
  END IF;

  SELECT e.name INTO event_name FROM events_ref e WHERE e.event_key = board.event_key;

  result := jsonb_build_object(
    'boardId', board.id,
    'orgId', board.org_id,
    'eventKey', board.event_key,
    'eventName', event_name,
    'name', board.name,
    'pickListId', board.pick_list_id,
    'state', board.state,
    'updatedAt', board.updated_at,
    'readOnly', true,
    'expiresAt', t.expires_at
  );
  RETURN result;
END;
$$;

DO $$ BEGIN CREATE ROLE vantage_alliance_board NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO vantage_alliance_board;
REVOKE ALL ON FUNCTION get_alliance_board_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_alliance_board_snapshot(text) TO vantage_alliance_board;
GRANT EXECUTE ON FUNCTION get_alliance_board_snapshot(text) TO vantage_app;
GRANT EXECUTE ON FUNCTION get_alliance_board_snapshot(text) TO vantage_worker;
