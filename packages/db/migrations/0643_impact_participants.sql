-- Outreach attribution: WHO was at an outreach activity, and for how long.
--
-- impact_activities (0038) records the event — title, date, duration, a bare
-- participant_count, people reached. That is enough for the Impact Award
-- evidence trail and useless for the question every team actually asks in
-- March: "how many outreach hours does each student have?" One person logs the
-- event; this table lets them name everyone who helped, each with their own
-- minutes (a mentor who stayed for setup and teardown is not the same as a
-- student who did one shift), and a per-person total falls out of it.
--
-- participant_count stays as the headline number. It may legitimately exceed
-- the named list — a parent volunteer without an account still counts as a
-- participant — so nothing here overwrites it, and the UI shows both.

CREATE TABLE impact_activity_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES impact_activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Their own time at this activity. NULL means "was there, time not recorded"
  -- and is shown as such — it is never counted as 0 and never backfilled from
  -- the activity's duration, which would credit setup hours to someone who
  -- came for the last twenty minutes.
  minutes integer CHECK (minutes IS NULL OR (minutes >= 0 AND minutes <= 24 * 60)),
  role text CHECK (role IS NULL OR char_length(role) <= 80),
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, user_id)
);

CREATE INDEX impact_activity_participants_org_user_idx
  ON impact_activity_participants (org_id, user_id);
CREATE INDEX impact_activity_participants_activity_idx
  ON impact_activity_participants (activity_id);

ALTER TABLE impact_activity_participants ENABLE ROW LEVEL SECURITY;

-- Any member can see who was at what: outreach hours are shared team record,
-- not private data, and students compare them openly.
CREATE POLICY impact_participants_member_read ON impact_activity_participants
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Any member can credit anyone on the team. The row stamps who did the
-- crediting, and the participant must actually be a member of this org — a
-- user id from another team is refused at the policy, not in app code.
CREATE POLICY impact_participants_member_insert ON impact_activity_participants
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND added_by = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM memberships m WHERE m.org_id = impact_activity_participants.org_id AND m.user_id = impact_activity_participants.user_id
    )
    AND EXISTS (
      SELECT 1 FROM impact_activities a WHERE a.id = impact_activity_participants.activity_id AND a.org_id = impact_activity_participants.org_id
    )
  );

-- Minutes can be corrected by whoever added the row, by the person it is
-- about, or by leadership.
CREATE POLICY impact_participants_update ON impact_activity_participants
  FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      added_by = current_app_user_id()
      OR user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    )
  )
  WITH CHECK (is_org_member(org_id));

CREATE POLICY impact_participants_delete ON impact_activity_participants
  FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      added_by = current_app_user_id()
      OR user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON impact_activity_participants TO vantage_app, vantage_worker;
