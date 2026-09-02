-- Scout shifts: contiguous blocks of qualification matches a scout owns, pinned to one
-- robot slot (alliance + station) so the same robot is never double-assigned. Shifts are
-- the human-readable plan; the per-match scout_assignments rows they expand into are what
-- Coverage / Lineup already count, so the two stay consistent by construction
-- (apps/web/app/api/scouting/coverage/route.ts writes both in one transaction).

CREATE TABLE scout_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_start integer NOT NULL CHECK (match_start > 0),
  match_end integer NOT NULL CHECK (match_end >= match_start),
  assigned_alliance text CHECK (assigned_alliance IS NULL OR assigned_alliance IN ('red','blue')),
  assigned_station integer CHECK (assigned_station IS NULL OR assigned_station BETWEEN 1 AND 3),
  notify_minutes_before integer NOT NULL DEFAULT 10
    CHECK (notify_minutes_before BETWEEN 0 AND 240),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, user_id, match_start)
);

CREATE INDEX scout_shifts_org_event_idx ON scout_shifts(org_id, event_key, match_start);

ALTER TABLE scout_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_shifts_member_read ON scout_shifts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
-- Coaches plan the roster; a scout may only touch shifts that are theirs (swap requests).
CREATE POLICY scout_shifts_member_insert ON scout_shifts FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR user_id = current_app_user_id())
  );
CREATE POLICY scout_shifts_member_update ON scout_shifts FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR user_id = current_app_user_id())
  )
  WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_shifts_member_delete ON scout_shifts FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR user_id = current_app_user_id())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_shifts TO vantage_app, vantage_worker;

CREATE TABLE scout_shift_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES scout_shifts(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT 'inapp' CHECK (channel IN ('inapp','push'))
);

CREATE INDEX scout_shift_notifications_shift_idx ON scout_shift_notifications(shift_id, sent_at DESC);

ALTER TABLE scout_shift_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_shift_notifications_member_read ON scout_shift_notifications FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_shift_notifications_member_insert ON scout_shift_notifications FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));

GRANT SELECT, INSERT ON scout_shift_notifications TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scout_shift_notifications TO vantage_worker;

-- Re-planning a roster replaces the per-match rows a previous plan expanded into.
-- 0003 granted vantage_app only SELECT/INSERT/UPDATE; assignments_coach_write (FOR ALL,
-- owner/admin) already gates DELETE at the policy level.
GRANT DELETE ON scout_assignments TO vantage_app;

-- Peer-insert so a coach can drop a "your shift starts at QM12" row into a member inbox.
DROP POLICY IF EXISTS notifications_scout_shift_insert ON notifications;
CREATE POLICY notifications_scout_shift_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scout_shift_assigned'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
