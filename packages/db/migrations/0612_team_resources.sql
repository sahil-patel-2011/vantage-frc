-- Team resources: a team's own material, attached to the onboarding track.
--
-- The setup guide in apps/web/lib/dev-setup/track.ts is the same for everyone —
-- WPILib installs the same way for team 6925 as for anyone else. What differs
-- per team is the material only that team has: the repo URL, the wiring
-- diagram, the coding standards doc, "ask Priya for the roboRIO password".
-- That is what this table holds, and it is why a resource can be pinned to a
-- specific step: the team's repo URL belongs next to "clone the repo", not in a
-- separate links page nobody opens.
--
-- Tenancy: org_id is NEVER taken from the request body. The API resolves it
-- from the caller's own membership and the RLS policy re-checks it, so a member
-- of one team cannot write a resource onto another team's guide even by forging
-- the payload. There is no "choose a team" control anywhere in this feature —
-- you get your team because it is the one you belong to.

CREATE TABLE team_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Matches Step.id in apps/web/lib/dev-setup/track.ts, or NULL for a resource
  -- that belongs to the whole guide rather than one step. Deliberately not a
  -- foreign key: the track is content that changes between seasons and a
  -- migration should not be needed to add a step. A resource whose step no
  -- longer exists falls back to the general list rather than disappearing.
  step_id text,
  title text NOT NULL CHECK (btrim(title) <> ''),
  -- Optional because plenty of what a team needs to say is not a link
  -- ("the shop key is in the blue cabinet").
  url text,
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'note'
    CHECK (kind IN ('note', 'link', 'repo', 'doc', 'video', 'contact')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_resources_org_step_idx ON team_resources (org_id, step_id);

ALTER TABLE team_resources ENABLE ROW LEVEL SECURITY;

-- Everyone on the team can read the team's own material, and only that.
CREATE POLICY team_resources_member_read ON team_resources FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Any member may add — a student who worked out the fix for a fiddly install
-- step is exactly who should be writing it down, not only the leads. The
-- WITH CHECK is what makes "their own team only" true at the database level.
CREATE POLICY team_resources_member_insert ON team_resources FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

-- Edit and remove stay with the author or a lead, so one person cannot quietly
-- rewrite another's note.
CREATE POLICY team_resources_author_update ON team_resources FOR UPDATE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR created_by = current_app_user_id()
  )
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR created_by = current_app_user_id()
  );

CREATE POLICY team_resources_author_delete ON team_resources FOR DELETE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR created_by = current_app_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON team_resources TO vantage_app, vantage_worker;
