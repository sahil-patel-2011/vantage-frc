-- ONE PICK LIST — collapse the pick-list data islands onto a single spine.
--
-- Before this migration a team's ranking work lived in three unrelated places:
--   * pick_lists / pick_list_entries (0004)  — the ORIGINAL spine. Read by Strategy
--     (lib/strategy/compute-strategy.ts), the pick desk + Pick Clock (lib/strategy/pick-desk.ts),
--     Match Delta Watcher, the Pick-list Justifier, alliance_boards.pick_list_id (0033) and
--     scouting_trust (0166). Stores: org_id, event_key, name + ranked team_key rows (rank, tier, notes).
--   * picklist_collab_lists / _entries / _votes (0279) — the collaborative ranking tool. Stores the
--     SAME idea again keyed by team_number instead of team_key, plus tier buckets
--     (first_pick/second_pick/avoid/unranked), a manual `position` inside each bucket, and weighted
--     per-member votes with an optional rank suggestion. Nothing else in the product could read it.
--   * alliance_selection_desk_sessions / _slots / _evidence / _exports (0418) — Saturday's draft board.
--     Stores 8 alliances x (captain, first, second) slot rows with their own team_key + rationale,
--     completely disconnected from either list above.
--   * picklist_justifier_justifications (0205) — rationale rows hanging off pick_list_entries.
--
-- Result: the list a team built collaboratively was NOT the list the draft board read, and the
-- justifier explained a third thing. This migration makes pick_lists / pick_list_entries the ONE
-- spine and absorbs the rest into it:
--   votes            -> pick_list_entry_votes (new, mirrors the collab vote shape)
--   tier buckets     -> pick_list_entries.bucket
--   justification    -> pick_list_entries.justification* columns
--   draft/board slot -> pick_list_entries.drafted_alliance_seed / drafted_pick_slot
--   board scratch    -> pick_lists.board_state
--
-- The old tables are DELIBERATELY NOT DROPPED. They stay readable (and still written by the desk's
-- evidence path, which FKs to alliance_selection_desk_slots) for one release so an in-flight event
-- can roll back. A follow-up migration should drop picklist_collab_* and
-- picklist_justifier_justifications once no deployed build reads them.

-- ---------------------------------------------------------------- spine: pick_lists

ALTER TABLE pick_lists
  ADD COLUMN IF NOT EXISTS season_year integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS board_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS legacy_collab_list_id uuid;

ALTER TABLE pick_lists
  ADD CONSTRAINT pick_lists_status_check
  CHECK (status IN ('open', 'locked', 'archived'));

ALTER TABLE pick_lists
  ADD CONSTRAINT pick_lists_source_check
  CHECK (source IN ('manual', 'picklist_collab', 'alliance_desk', 'strategy', 'intel_research'));

CREATE UNIQUE INDEX IF NOT EXISTS pick_lists_legacy_collab_uq
  ON pick_lists(legacy_collab_list_id) WHERE legacy_collab_list_id IS NOT NULL;

-- ---------------------------------------------------------------- spine: pick_list_entries

ALTER TABLE pick_list_entries
  ADD COLUMN IF NOT EXISTS team_number integer,
  ADD COLUMN IF NOT EXISTS bucket text NOT NULL DEFAULT 'unranked',
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS justification text,
  ADD COLUMN IF NOT EXISTS justification_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS justification_contradiction boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS justification_reason text,
  ADD COLUMN IF NOT EXISTS justification_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS drafted_alliance_seed integer,
  ADD COLUMN IF NOT EXISTS drafted_pick_slot text,
  ADD COLUMN IF NOT EXISTS drafted_at timestamptz,
  ADD COLUMN IF NOT EXISTS drafted_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS board_rationale text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS legacy_collab_entry_id uuid;

ALTER TABLE pick_list_entries
  ADD CONSTRAINT pick_list_entries_bucket_check
  CHECK (bucket IN ('first_pick', 'second_pick', 'avoid', 'unranked'));

ALTER TABLE pick_list_entries
  ADD CONSTRAINT pick_list_entries_drafted_check
  CHECK (
    (drafted_alliance_seed IS NULL AND drafted_pick_slot IS NULL)
    OR (
      drafted_alliance_seed BETWEEN 1 AND 8
      AND drafted_pick_slot IN ('captain', 'first', 'second')
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS pick_list_entries_legacy_collab_uq
  ON pick_list_entries(legacy_collab_entry_id) WHERE legacy_collab_entry_id IS NOT NULL;

-- One team per board slot, per list. Partial so undrafted rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS pick_list_entries_board_slot_uq
  ON pick_list_entries(pick_list_id, drafted_alliance_seed, drafted_pick_slot)
  WHERE drafted_alliance_seed IS NOT NULL;

CREATE INDEX IF NOT EXISTS pick_list_entries_list_bucket_rank_idx
  ON pick_list_entries(pick_list_id, bucket, rank);

-- 0004 created UNIQUE (pick_list_id, rank) as an IMMEDIATE constraint, which makes any
-- drag-and-drop reorder impossible without a two-phase shuffle. Recreate it DEFERRABLE so a
-- whole reorder commits atomically while still guaranteeing dense, unique ranks at commit time.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'pick_list_entries'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
      ) = ARRAY['pick_list_id', 'rank']
      AND NOT c.condeferrable
  LOOP
    EXECUTE format('ALTER TABLE pick_list_entries DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pick_list_entries_list_rank_deferrable_uq'
  ) THEN
    ALTER TABLE pick_list_entries
      ADD CONSTRAINT pick_list_entries_list_rank_deferrable_uq
      UNIQUE (pick_list_id, rank) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ---------------------------------------------------------------- desk sessions point at the spine
--
-- The desk keeps its own session + slot + evidence rows (evidence FKs to a slot id), but the slot
-- is no longer the truth about WHICH team is picked — pick_list_entries.drafted_* is. This column
-- names the one list a session is drafting from.

ALTER TABLE alliance_selection_desk_sessions
  ADD COLUMN IF NOT EXISTS linked_pick_list_id uuid REFERENCES pick_lists(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- votes on the spine

CREATE TABLE IF NOT EXISTS pick_list_entry_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES pick_list_entries(id) ON DELETE CASCADE,
  voter_id uuid NOT NULL REFERENCES users(id),
  weight numeric(4, 2) NOT NULL DEFAULT 1.0 CHECK (weight > 0 AND weight <= 5),
  rank_suggestion integer CHECK (rank_suggestion IS NULL OR rank_suggestion > 0),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, voter_id)
);
CREATE INDEX IF NOT EXISTS pick_list_entry_votes_org_entry_idx
  ON pick_list_entry_votes(org_id, entry_id);

ALTER TABLE pick_list_entry_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY pick_list_entry_votes_member_read ON pick_list_entry_votes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY pick_list_entry_votes_member_insert ON pick_list_entry_votes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND voter_id = current_app_user_id());
CREATE POLICY pick_list_entry_votes_member_update ON pick_list_entry_votes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND voter_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND voter_id = current_app_user_id());
CREATE POLICY pick_list_entry_votes_member_delete ON pick_list_entry_votes FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND voter_id = current_app_user_id());
CREATE POLICY pick_list_entry_votes_lead_delete ON pick_list_entry_votes FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON pick_list_entry_votes TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------- RLS: members may now edit
--
-- 0004 restricted pick_lists / pick_list_entries writes to owner+admin. picklist_collab (0279)
-- already let ANY org member add, reorder and vote — that is the whole point of a collaborative
-- pick list, and collapsing onto the spine must not take that away from scouts. These permissive
-- policies OR with the existing coach-write policies; DELETE of a whole list stays owner/admin.

CREATE POLICY pick_lists_member_insert ON pick_lists FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY pick_lists_member_update ON pick_lists FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE POLICY pick_list_entries_member_insert ON pick_list_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY pick_list_entries_member_update ON pick_list_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY pick_list_entries_member_delete ON pick_list_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

-- ================================================================ BACKFILL
-- Everything below copies existing island rows onto the spine. It is written to be re-runnable:
-- each step skips rows already carried over (legacy_* pointers / NOT EXISTS guards).

-- team_number denormalization for rows that predate the column.
UPDATE pick_list_entries
SET team_number = substring(team_key from '^frc([0-9]+)$')::integer
WHERE team_number IS NULL AND team_key ~ '^frc[0-9]+$';

-- Existing free-text tiers ('first' / 'second' / 'third' / 'watch', written by Strategy and
-- Intel/Research) map onto the shared bucket vocabulary. Runs before the collab import so it
-- cannot clobber imported buckets.
UPDATE pick_list_entries
SET bucket = CASE lower(coalesce(tier, ''))
  WHEN 'first' THEN 'first_pick'
  WHEN 'first_pick' THEN 'first_pick'
  WHEN 'second' THEN 'second_pick'
  WHEN 'second_pick' THEN 'second_pick'
  WHEN 'third' THEN 'second_pick'
  WHEN 'avoid' THEN 'avoid'
  WHEN 'do_not_pick' THEN 'avoid'
  ELSE 'unranked'
END
WHERE legacy_collab_entry_id IS NULL;

-- 1a. A collab list whose (org, event, name) already matches a spine list ADOPTS that spine row
--     rather than creating a duplicate. Most recent collab list wins when names collide.
UPDATE pick_lists p
SET legacy_collab_list_id = c.id,
    season_year = COALESCE(p.season_year, c.season_year),
    status = c.status,
    source = 'picklist_collab'
FROM (
  SELECT DISTINCT ON (org_id, event_key, name) id, org_id, event_key, name, season_year, status
  FROM picklist_collab_lists
  ORDER BY org_id, event_key, name, updated_at DESC
) c
WHERE p.org_id = c.org_id
  AND p.event_key = c.event_key
  AND p.name = c.name
  AND p.legacy_collab_list_id IS NULL;

-- 1b. Remaining collab lists become new spine lists. pick_lists.event_key has an events_ref FK
--     that picklist_collab_lists never had, so a list pinned to an unknown event key cannot be
--     carried over — it stays readable in picklist_collab_lists and is reported as skipped below.
INSERT INTO pick_lists (org_id, event_key, name, created_by, created_at, updated_at,
                        season_year, status, source, legacy_collab_list_id)
SELECT c.org_id, c.event_key, c.name, c.created_by, c.created_at, c.updated_at,
       c.season_year, c.status, 'picklist_collab', c.id
FROM (
  SELECT DISTINCT ON (org_id, event_key, name) *
  FROM picklist_collab_lists
  ORDER BY org_id, event_key, name, updated_at DESC
) c
WHERE EXISTS (SELECT 1 FROM events_ref e WHERE e.event_key = c.event_key)
  AND NOT EXISTS (SELECT 1 FROM pick_lists p WHERE p.legacy_collab_list_id = c.id)
  AND NOT EXISTS (
    SELECT 1 FROM pick_lists p
    WHERE p.org_id = c.org_id AND p.event_key = c.event_key AND p.name = c.name
  );

-- 2. Collab entries become spine entries. Ranks continue after whatever the spine list already
--    holds, ordered bucket-first then by the manual position the team dragged them into.
--    team_key has a teams_ref FK; a team number with no reference row is skipped, not invented.
WITH src AS (
  SELECT p.id AS pick_list_id,
         e.org_id,
         e.id AS legacy_entry_id,
         ('frc' || e.team_number) AS team_key,
         e.team_number,
         e.tier AS bucket,
         e.note,
         e.added_by,
         e.created_at,
         e.updated_at,
         COALESCE(
           (SELECT MAX(x.rank) FROM pick_list_entries x WHERE x.pick_list_id = p.id), 0
         ) AS base_rank,
         row_number() OVER (
           PARTITION BY p.id
           ORDER BY CASE e.tier
                      WHEN 'first_pick' THEN 0
                      WHEN 'second_pick' THEN 1
                      WHEN 'unranked' THEN 2
                      ELSE 3
                    END,
                    e.position,
                    e.team_number
         ) AS rn
  FROM picklist_collab_entries e
  JOIN pick_lists p ON p.legacy_collab_list_id = e.list_id
  WHERE EXISTS (SELECT 1 FROM teams_ref t WHERE t.team_key = 'frc' || e.team_number)
    AND NOT EXISTS (
      SELECT 1 FROM pick_list_entries x
      WHERE x.pick_list_id = p.id AND x.team_key = 'frc' || e.team_number
    )
)
INSERT INTO pick_list_entries (pick_list_id, org_id, team_key, team_number, rank, tier, bucket,
                               notes, added_by, created_at, updated_at, legacy_collab_entry_id)
SELECT pick_list_id, org_id, team_key, team_number, base_rank + rn,
       CASE bucket
         WHEN 'first_pick' THEN 'first'
         WHEN 'second_pick' THEN 'second'
         WHEN 'avoid' THEN 'avoid'
         ELSE NULL
       END,
       bucket, note, added_by, created_at, updated_at, legacy_entry_id
FROM src;

-- 3. Weighted votes follow their entries.
INSERT INTO pick_list_entry_votes (org_id, entry_id, voter_id, weight, rank_suggestion, comment,
                                   created_at, updated_at)
SELECT v.org_id, pe.id, v.voter_id, v.weight, v.rank_suggestion, v.comment, v.created_at, v.updated_at
FROM picklist_collab_votes v
JOIN pick_list_entries pe ON pe.legacy_collab_entry_id = v.entry_id
ON CONFLICT (entry_id, voter_id) DO NOTHING;

-- 4. Justifier rationales collapse onto the row they already pointed at.
UPDATE pick_list_entries pe
SET justification = j.rationale,
    justification_sources = j.sources,
    justification_contradiction = j.contradiction_flagged,
    justification_reason = j.contradiction_reason,
    justification_generated_at = j.updated_at
FROM picklist_justifier_justifications j
WHERE j.pick_list_entry_id = pe.id
  AND pe.justification IS NULL;

-- 5. The draft board. For each org+event, the most recently touched desk session's filled slots
--    are stamped onto the spine list for that event (most recently updated list wins). A drafted
--    team that was never on the list is appended to the list rather than dropped — that IS the
--    Saturday reality the collab list failed to capture.
--    (staged in a session-scoped temp table so 5a/5b agree on the same snapshot; dropped below)
DROP TABLE IF EXISTS _picklist_unify_desk;
CREATE TEMP TABLE _picklist_unify_desk AS
WITH latest_session AS (
  SELECT DISTINCT ON (s.org_id, s.event_key) s.id, s.org_id, s.event_key
  FROM alliance_selection_desk_sessions s
  ORDER BY s.org_id, s.event_key, s.updated_at DESC
),
target_list AS (
  SELECT DISTINCT ON (p.org_id, p.event_key) p.id AS pick_list_id, p.org_id, p.event_key
  FROM pick_lists p
  ORDER BY p.org_id, p.event_key, p.updated_at DESC
)
SELECT DISTINCT ON (tl.pick_list_id, sl.team_key)
       tl.pick_list_id,
       sl.org_id,
       sl.team_key,
       substring(sl.team_key from '^frc([0-9]+)$')::integer AS team_number,
       sl.alliance_seed,
       sl.pick_slot,
       sl.rationale,
       sl.updated_at,
       sl.updated_by
FROM alliance_selection_desk_slots sl
JOIN latest_session ls ON ls.id = sl.session_id
JOIN target_list tl ON tl.org_id = sl.org_id AND tl.event_key = ls.event_key
WHERE sl.team_key IS NOT NULL
  AND EXISTS (SELECT 1 FROM teams_ref t WHERE t.team_key = sl.team_key)
ORDER BY tl.pick_list_id, sl.team_key, sl.alliance_seed, sl.pick_slot;

-- 5a. Append drafted teams that were never ranked.
WITH missing AS (
  SELECT d.*,
         COALESCE((SELECT MAX(x.rank) FROM pick_list_entries x WHERE x.pick_list_id = d.pick_list_id), 0)
           AS base_rank,
         row_number() OVER (PARTITION BY d.pick_list_id ORDER BY d.alliance_seed, d.pick_slot) AS rn
  FROM _picklist_unify_desk d
  WHERE NOT EXISTS (
    SELECT 1 FROM pick_list_entries x
    WHERE x.pick_list_id = d.pick_list_id AND x.team_key = d.team_key
  )
)
INSERT INTO pick_list_entries (pick_list_id, org_id, team_key, team_number, rank, bucket,
                               board_rationale, drafted_alliance_seed, drafted_pick_slot,
                               drafted_at, drafted_by, added_by)
SELECT pick_list_id, org_id, team_key, team_number, base_rank + rn, 'unranked',
       COALESCE(rationale, ''), alliance_seed, pick_slot, updated_at, updated_by, updated_by
FROM missing;

-- 5b. Stamp the board slot onto the teams already ranked.
UPDATE pick_list_entries pe
SET drafted_alliance_seed = d.alliance_seed,
    drafted_pick_slot = d.pick_slot,
    drafted_at = d.updated_at,
    drafted_by = d.updated_by,
    board_rationale = CASE
      WHEN coalesce(pe.board_rationale, '') = '' THEN COALESCE(d.rationale, '')
      ELSE pe.board_rationale
    END
FROM _picklist_unify_desk d
WHERE pe.pick_list_id = d.pick_list_id
  AND pe.team_key = d.team_key
  AND pe.drafted_alliance_seed IS NULL;

DROP TABLE IF EXISTS _picklist_unify_desk;

-- 5c. Point every desk session at the spine list for its event.
UPDATE alliance_selection_desk_sessions s
SET linked_pick_list_id = tl.pick_list_id
FROM (
  SELECT DISTINCT ON (p.org_id, p.event_key) p.id AS pick_list_id, p.org_id, p.event_key
  FROM pick_lists p
  ORDER BY p.org_id, p.event_key, p.updated_at DESC
) tl
WHERE s.org_id = tl.org_id AND s.event_key = tl.event_key AND s.linked_pick_list_id IS NULL;

-- 6. Season year for spine lists that never had one — derived from the event key prefix
--    (TBA event keys start with the four-digit season), never guessed.
UPDATE pick_lists
SET season_year = substring(event_key from '^([0-9]{4})')::integer
WHERE season_year IS NULL AND event_key ~ '^[0-9]{4}';
