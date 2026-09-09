-- Announcements, finished.
--
-- `team_announcements` (0136) already carries `require_ack`, but nothing ever
-- stored an acknowledgement, so "everyone must confirm they read this" was a
-- boolean that did nothing. For an FRC team the acknowledged cases are the ones
-- that matter: a safety rule change, a departure time, a permission deadline.
-- "Who has not seen this yet" is the whole point of the flag.
--
-- The table also had no page and no API. This adds the missing half of the data
-- model plus the peer-insert policy the inbox fan-out needs.

CREATE TABLE announcement_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL REFERENCES team_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX announcement_acks_org_idx ON announcement_acks (org_id, announcement_id);

ALTER TABLE announcement_acks ENABLE ROW LEVEL SECURITY;

-- Everyone in the team can see who has acknowledged. This is deliberate: an
-- acknowledgement is a public act within the team ("22 of 30 have read this"),
-- and hiding it would make the feature useless to the leads chasing the other 8
-- while telling members nothing they did not already know about themselves.
CREATE POLICY announcement_acks_member_read ON announcement_acks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- You may only acknowledge as yourself.
CREATE POLICY announcement_acks_self_insert ON announcement_acks FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY announcement_acks_self_delete ON announcement_acks FOR DELETE TO vantage_app
  USING (user_id = current_app_user_id());

GRANT SELECT, INSERT, DELETE ON announcement_acks TO vantage_app, vantage_worker;

-- Inbox fan-out: posting an announcement writes one notification per member.
-- Same shape as notifications_duty_peer_insert (0146) — the recipient must be a
-- member of the same org as the poster, so this cannot address anyone outside
-- the team. Overlapping INSERT policies are OR'd.
DROP POLICY IF EXISTS notifications_announcement_peer_insert ON notifications;
CREATE POLICY notifications_announcement_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'team_announcement'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );

-- Deliberately NOT narrowing team_announcements INSERT to owners/admins.
--
-- 0136 allows any member to insert, and that is load-bearing: notify-match.ts
-- writes the match alert as whoever happened to open My Day, which is usually a
-- scout, and that write sits inside a swallowed catch — so tightening the
-- policy here would stop match alerts appearing and report nothing. Authoring
-- from the Announcements page is gated to owners/admins in the API instead,
-- where a person posting and a background alert can be told apart.
