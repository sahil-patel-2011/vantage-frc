-- Collaborative pick-list editing: a shared, real-time-editable pick list per event where
-- multiple scouts/strategists can propose team ordering and cast weighted votes (e.g. lead
-- strategist counts more than a rookie scout) that roll up into a consensus rank.

CREATE TABLE picklist_collab_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  name text NOT NULL,
  season_year integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'archived')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX picklist_collab_lists_org_event_idx ON picklist_collab_lists(org_id, event_key);

CREATE TABLE picklist_collab_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES picklist_collab_lists(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number > 0),
  team_name text,
  tier text NOT NULL DEFAULT 'first_pick' CHECK (tier IN ('first_pick', 'second_pick', 'avoid', 'unranked')),
  position integer NOT NULL DEFAULT 0,
  note text,
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, team_number)
);
CREATE INDEX picklist_collab_entries_list_idx ON picklist_collab_entries(list_id, tier, position);

CREATE TABLE picklist_collab_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES picklist_collab_entries(id) ON DELETE CASCADE,
  voter_id uuid NOT NULL REFERENCES users(id),
  weight numeric(4, 2) NOT NULL DEFAULT 1.0 CHECK (weight > 0 AND weight <= 5),
  rank_suggestion integer,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, voter_id)
);
CREATE INDEX picklist_collab_votes_entry_idx ON picklist_collab_votes(entry_id);

ALTER TABLE picklist_collab_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE picklist_collab_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE picklist_collab_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY picklist_collab_lists_member_read ON picklist_collab_lists FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY picklist_collab_lists_member_insert ON picklist_collab_lists FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY picklist_collab_lists_member_update ON picklist_collab_lists FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY picklist_collab_lists_member_delete ON picklist_collab_lists FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY picklist_collab_entries_member_read ON picklist_collab_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY picklist_collab_entries_member_insert ON picklist_collab_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND added_by = current_app_user_id());
CREATE POLICY picklist_collab_entries_member_update ON picklist_collab_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY picklist_collab_entries_member_delete ON picklist_collab_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY picklist_collab_votes_member_read ON picklist_collab_votes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY picklist_collab_votes_member_insert ON picklist_collab_votes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND voter_id = current_app_user_id());
CREATE POLICY picklist_collab_votes_member_update ON picklist_collab_votes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY picklist_collab_votes_member_delete ON picklist_collab_votes FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON picklist_collab_lists TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON picklist_collab_entries TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON picklist_collab_votes TO vantage_app, vantage_worker;
