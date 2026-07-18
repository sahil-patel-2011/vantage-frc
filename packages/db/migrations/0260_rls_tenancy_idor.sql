-- Close cross-tenant IDOR gaps: alliance board share tokens must bind to a board
-- in the same org (SECURITY DEFINER snapshot previously loaded board by id alone),
-- and knowledge_links must keep page_id within the row's org_id.

-- Alliance board share tokens -------------------------------------------------

DELETE FROM alliance_board_share_tokens t
WHERE NOT EXISTS (
  SELECT 1 FROM alliance_boards b
  WHERE b.id = t.board_id AND b.org_id = t.org_id
);

ALTER TABLE alliance_boards
  DROP CONSTRAINT IF EXISTS alliance_boards_id_org_unique;
ALTER TABLE alliance_boards
  ADD CONSTRAINT alliance_boards_id_org_unique UNIQUE (id, org_id);

ALTER TABLE alliance_board_share_tokens
  DROP CONSTRAINT IF EXISTS alliance_board_share_tokens_board_id_fkey;
ALTER TABLE alliance_board_share_tokens
  DROP CONSTRAINT IF EXISTS alliance_board_share_tokens_board_org_fkey;
ALTER TABLE alliance_board_share_tokens
  ADD CONSTRAINT alliance_board_share_tokens_board_org_fkey
  FOREIGN KEY (board_id, org_id) REFERENCES alliance_boards(id, org_id) ON DELETE CASCADE;

DROP POLICY IF EXISTS alliance_board_tokens_admin ON alliance_board_share_tokens;
CREATE POLICY alliance_board_tokens_admin ON alliance_board_share_tokens FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM alliance_boards b
      WHERE b.id = board_id AND b.org_id = org_id
    )
  );

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

  SELECT * INTO board
  FROM alliance_boards
  WHERE id = t.board_id AND org_id = t.org_id;
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

REVOKE ALL ON FUNCTION get_alliance_board_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_alliance_board_snapshot(text) TO vantage_alliance_board;
GRANT EXECUTE ON FUNCTION get_alliance_board_snapshot(text) TO vantage_app;
GRANT EXECUTE ON FUNCTION get_alliance_board_snapshot(text) TO vantage_worker;

-- Knowledge wiki links --------------------------------------------------------

DELETE FROM knowledge_links kl
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_pages p
  WHERE p.id = kl.page_id AND p.org_id = kl.org_id
);

ALTER TABLE knowledge_pages
  DROP CONSTRAINT IF EXISTS knowledge_pages_id_org_unique;
ALTER TABLE knowledge_pages
  ADD CONSTRAINT knowledge_pages_id_org_unique UNIQUE (id, org_id);

ALTER TABLE knowledge_links
  DROP CONSTRAINT IF EXISTS knowledge_links_page_id_fkey;
ALTER TABLE knowledge_links
  DROP CONSTRAINT IF EXISTS knowledge_links_page_org_fkey;
ALTER TABLE knowledge_links
  ADD CONSTRAINT knowledge_links_page_org_fkey
  FOREIGN KEY (page_id, org_id) REFERENCES knowledge_pages(id, org_id) ON DELETE CASCADE;

ALTER TABLE knowledge_links
  DROP CONSTRAINT IF EXISTS knowledge_links_unique;
ALTER TABLE knowledge_links
  ADD CONSTRAINT knowledge_links_unique UNIQUE (org_id, page_id, target_type, target_id);

DROP POLICY IF EXISTS knowledge_links_member_insert ON knowledge_links;
CREATE POLICY knowledge_links_member_insert ON knowledge_links FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM knowledge_pages p
      WHERE p.id = page_id AND p.org_id = org_id
    )
  );
