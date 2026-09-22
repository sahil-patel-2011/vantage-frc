-- What a team notices about next year's game, before there is a game.
--
-- Teams already collect this. Someone sees what FTC's game asks robots to do,
-- someone screenshots a teaser, and it lives in a group chat until January, by
-- which point nobody can find it. This is that chat with a shape: every row
-- carries who saw it, where, and when, so a claim can be traced back to a
-- source instead of being repeated until it sounds true.
--
-- Note what is deliberately absent: there is no column for a predicted game.
-- Vantage has no honest basis for one, and a guess stored next to real
-- observations would be indistinguishable from them a month later.

CREATE TABLE next_season_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The season this is about, not the season it was recorded in.
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 2100),
  kind text NOT NULL CHECK (kind IN ('announcement', 'ftc-game', 'teaser', 'rumour')),
  -- When it was seen, which is not when it was typed in. Ordering by entry time
  -- would put a teaser someone remembered late ahead of one seen first.
  observed_on date NOT NULL,
  -- A link, a video, a person. Identity is load-bearing: corroboration is
  -- counted by distinct source, so two people forwarding one tweet is one
  -- source, not two.
  source text NOT NULL DEFAULT '',
  note text NOT NULL,
  -- What the person who recorded it thinks it points at. Their read, stored as
  -- theirs; the aggregate never claims more certainty than its inputs.
  points_at text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Kept as history when the person leaves the team. Losing who saw a signal is
  -- better than losing the signal.
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX next_season_signals_org_idx
  ON next_season_signals(org_id, season_year, observed_on DESC);

ALTER TABLE next_season_signals ENABLE ROW LEVEL SECURITY;

-- Anyone on the team can add one and anyone can read them. Noticing a teaser is
-- not a privilege, and a note nobody may file is a note that stays in the chat.
CREATE POLICY next_season_signals_member_read ON next_season_signals FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY next_season_signals_member_insert ON next_season_signals FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

-- Editing is open to the team, matching how scouting forms work: the point is a
-- shared record, not a set of personal ones.
CREATE POLICY next_season_signals_member_update ON next_season_signals FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY next_season_signals_member_delete ON next_season_signals FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON next_season_signals TO vantage_app;
GRANT SELECT ON next_season_signals TO vantage_worker;
