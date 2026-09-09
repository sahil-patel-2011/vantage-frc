-- Team dossier: what is publicly known about this team, gathered once, kept
-- fresh, and handed to every AI feature as context.
--
-- The first thing a new team should see is that Vantage already knows who they
-- are — where they are, how long they have competed, what they have won, how
-- their seasons have gone — without anyone typing it in. All of it comes from
-- The Blue Alliance and Statbotics, which are public; none of it is invented,
-- and any field either source does not have stays NULL and is shown as
-- "not on record", never as a guess.
--
-- People are deliberately NOT here. Neither source knows who a team's mentors
-- or students are, and Vantage's own roster (memberships) is the only honest
-- answer to that — the profile page shows roster counts from memberships and
-- links to People, rather than scraping names from anywhere.
--
-- One row per org. Built on demand by an owner/admin (the Team page asks for
-- it on first visit) and refreshed weekly by the season cron piggyback.

CREATE TABLE team_dossiers (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number > 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  -- TBA team profile: nickname, name, city, state_prov, country, rookie_year, website, school_name.
  profile jsonb,
  -- Every season the team appeared at an event, per TBA. Longevity = its length.
  years_participated integer[] NOT NULL DEFAULT '{}',
  -- [{year, eventKey, eventName, name}] — TBA awards, newest first.
  awards jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{year, eventKey, name, week, rank, teams, wins, losses, ties, playoff}] — recent seasons.
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Statbotics career + per-year EPA and ranks: {normEpa, record, years:[{year, epa, rankWorld, rankCountry, rankState, teamsWorld}]}.
  stats jsonb,
  -- Which source answered, and when. A source that was unreachable is recorded
  -- as such so the page can say "Statbotics did not answer" instead of showing
  -- an empty box that looks like the team has no results.
  sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  computed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE team_dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_dossiers_member_read ON team_dossiers FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Owners/admins request and record a build for their own org. The team number
-- must be the org's own — a dossier for someone else's number is meaningless
-- here and the policy refuses it rather than trusting the request body.
CREATE POLICY team_dossiers_admin_insert ON team_dossiers FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND team_number = (SELECT o.team_number FROM organizations o WHERE o.id = team_dossiers.org_id)
  );
CREATE POLICY team_dossiers_admin_update ON team_dossiers FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND team_number = (SELECT o.team_number FROM organizations o WHERE o.id = team_dossiers.org_id)
  );

GRANT SELECT, INSERT, UPDATE ON team_dossiers TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_dossiers TO vantage_worker;

CREATE INDEX team_dossiers_refresh_idx ON team_dossiers (computed_at NULLS FIRST)
  WHERE status IN ('ready', 'failed', 'queued');
