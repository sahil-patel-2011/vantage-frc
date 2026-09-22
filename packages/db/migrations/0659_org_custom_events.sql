-- Offseason and regional events that The Blue Alliance does not carry.
--
-- GRITS, and its equivalents around the world, are real competitions where real
-- teams do real scouting. Until now the active event had to exist in events_ref,
-- which is filled from TBA, so a team at an offseason event could not point
-- Vantage at the thing they were standing in.
--
-- The rows go into events_ref rather than a parallel table on purpose: roughly
-- ninety places in the product join events_ref for schedule, scouting, intel and
-- strategy, and every one of them should treat an offseason event exactly like a
-- district. A second table would mean ninety unions and ninety chances to forget
-- one.
--
-- That makes isolation the whole job of this migration. events_ref was readable
-- by any signed-in user, which is correct for shared TBA data and would be a
-- leak the moment org-owned rows live alongside it.

ALTER TABLE events_ref
  ADD COLUMN org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  -- Kept as history when the person who added it leaves the team; losing the
  -- event because its author was removed would be worse than losing the name.
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN events_ref.org_id IS
  'NULL for shared TBA-synced events. Set for an event one team created for itself.';

CREATE INDEX events_ref_org_idx ON events_ref(org_id) WHERE org_id IS NOT NULL;

-- Shared TBA rows stay visible to everyone signed in. An org's own events are
-- visible only to that org.
DROP POLICY IF EXISTS events_authenticated_read ON events_ref;
CREATE POLICY events_shared_or_own_read ON events_ref FOR SELECT TO vantage_app
  USING (
    current_app_user_id() IS NOT NULL
    AND (org_id IS NULL OR is_org_member(org_id))
  );

-- Writes are limited three ways: to an org you administer, to rows that org
-- owns, and to keys inside the custom namespace. The namespace check is what
-- stops a team from inserting a row that shadows a real TBA event key and then
-- having the next ingest fight it; TBA keys are year-plus-lowercase-alphanumeric
-- and never contain a hyphen.
CREATE POLICY events_org_insert ON events_ref FOR INSERT TO vantage_app
  WITH CHECK (
    org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND event_key ~ '^[0-9]{4}custom-[a-z0-9]{8}-[a-z0-9-]{1,40}$'
  );

CREATE POLICY events_org_update ON events_ref FOR UPDATE TO vantage_app
  USING (org_id IS NOT NULL AND has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

-- Deleting an event that has scouting behind it is refused by the existing
-- foreign keys from scout entries, matches and intel, which is the behaviour we
-- want: a team that has collected data at an event should not be able to erase
-- it by tidying up a list.
CREATE POLICY events_org_delete ON events_ref FOR DELETE TO vantage_app
  USING (org_id IS NOT NULL AND has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT INSERT, UPDATE, DELETE ON events_ref TO vantage_app;
