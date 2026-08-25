-- Parent communications: contacts, weekly digest log, and a token-scoped
-- read-only parent view (R&D gap #6 — "I don't have a great way to directly
-- communicate with the parents").
--
-- Deliberately NOT a chat surface. This is one-way, org -> parent:
--   * no reply path, no messaging tables;
--   * the parent view renders only org name/team number, upcoming events
--     (title/start/end/location) and the linked student's OWN RSVP state;
--   * no student contact info and no other student's name ever leave the org.
-- That shape sidesteps YPP (Youth Protection Program) adult<->minor contact
-- exposure by design: a parent is never a Vantage user, never in team chat,
-- and never sees roster data.
--
-- Parents are NOT users rows — parent_contacts carries its own unsubscribe
-- token (one-click, no session) and its own opaque view token, following the
-- calendar_feed_tokens capability-token shape from 0144: SECURITY DEFINER
-- resolver, NULL for unknown tokens, no unauthenticated dump.
--
-- Parent contact details are adult PII attached to minors, so every
-- parent_contacts policy is owner/admin only — never readable by every scout.

CREATE TABLE parent_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The student this parent belongs to, when that student is a Vantage user.
  member_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- For teams that have not made the student a user yet ("Jordan, Mechanical").
  student_label text NOT NULL DEFAULT '' CHECK (char_length(student_label) <= 120),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (
    char_length(email) <= 254
    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 32),
  -- BCP-47-ish language tag ('en', 'es', 'zh-Hans', 'pt-BR', ...).
  preferred_language text NOT NULL DEFAULT 'en' CHECK (
    char_length(preferred_language) <= 12
    AND preferred_language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'
  ),
  digest_opt_in boolean NOT NULL DEFAULT true,
  -- One-click unsubscribe capability (parents have no account to sign in to).
  unsubscribe_token text NOT NULL UNIQUE
    CHECK (unsubscribe_token ~ '^[A-Za-z0-9_-]{16,100}$'),
  -- Read-only parent view capability (see get_parent_view below).
  view_token text NOT NULL UNIQUE
    CHECK (view_token ~ '^[A-Za-z0-9_-]{16,100}$'),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One contact row per parent email per org (case-insensitive).
CREATE UNIQUE INDEX parent_contacts_org_email_uidx
  ON parent_contacts (org_id, lower(email));
CREATE INDEX parent_contacts_org_idx ON parent_contacts(org_id, active, lower(name));
CREATE INDEX parent_contacts_member_idx
  ON parent_contacts(org_id, member_user_id) WHERE member_user_id IS NOT NULL;

ALTER TABLE parent_contacts ENABLE ROW LEVEL SECURITY;

-- Adult PII attached to minors: owners/admins only, for every operation.
CREATE POLICY parent_contacts_admin_select ON parent_contacts
  FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY parent_contacts_admin_insert ON parent_contacts
  FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY parent_contacts_admin_update ON parent_contacts
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY parent_contacts_admin_delete ON parent_contacts
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON parent_contacts TO vantage_app, vantage_worker;

-- Append-only delivery log: one row per contact per digest attempt. Honest
-- outcomes only — 'setup_required' when email delivery is not configured,
-- 'skipped' when there was nothing real to send or the parent opted out.
-- translated_to records the language ACTUALLY delivered (NULL = untranslated
-- English body); it is never set when translation failed or was unavailable.
CREATE TABLE parent_digest_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES parent_contacts(id) ON DELETE CASCADE,
  subject text NOT NULL DEFAULT '',
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'skipped', 'failed', 'setup_required')),
  reason text,
  translated_to text CHECK (translated_to IS NULL OR char_length(translated_to) <= 12),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parent_digest_sends_org_idx
  ON parent_digest_sends(org_id, created_at DESC);
CREATE INDEX parent_digest_sends_contact_idx
  ON parent_digest_sends(contact_id, created_at DESC);

ALTER TABLE parent_digest_sends ENABLE ROW LEVEL SECURITY;

-- Owners/admins read the log and record request-path sends. Deliberately NO
-- update/delete policy: the log is append-only for the app role.
CREATE POLICY parent_digest_sends_admin_select ON parent_digest_sends
  FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY parent_digest_sends_admin_insert ON parent_digest_sends
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT ON parent_digest_sends TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON parent_digest_sends TO vantage_worker;

-- ---------------------------------------------------------------------------
-- Token-scoped parent view resolver (same shape as get_calendar_feed, 0144):
-- SECURITY DEFINER so the unauthenticated route can read past RLS, but it
-- returns ONLY org name/team number, upcoming events (title/start/end/location
-- + recurrence fields so the route can expand series), and the linked
-- student's OWN RSVP per event. No notes/descriptions (they may name other
-- students), no roster, no contact info. Unknown/deactivated tokens -> NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_parent_view(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  contact parent_contacts%ROWTYPE;
  result jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR length(p_token) > 100 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO contact FROM parent_contacts
  WHERE view_token = p_token AND active = true;
  IF contact.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'orgName', o.name,
    'teamNumber', o.team_number,
    'studentLabel', contact.student_label,
    'studentLinked', contact.member_user_id IS NOT NULL,
    'events', COALESCE((
      SELECT jsonb_agg(ev ORDER BY ev->>'startsAt')
      FROM (
        SELECT jsonb_build_object(
          'id', e.id::text,
          'title', e.title,
          'kind', e.kind,
          'location', e.location,
          'startsAt', e.starts_at,
          'endsAt', e.ends_at,
          'rrule', e.rrule,
          'recurrenceEnd', e.recurrence_end,
          'timeZone', e.recurrence_timezone,
          'seriesId', CASE WHEN e.series_id IS NOT NULL AND e.series_id <> e.id
                           THEN e.series_id::text END,
          -- All exception kinds suppress the master occurrence on expansion
          -- (moved/edited occurrences arrive as their own detached rows).
          'exceptions', CASE WHEN e.rrule IS NULL THEN '[]'::jsonb ELSE COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'occurrenceDate', x.occurrence_date,
              'action', x.action
            ) ORDER BY x.occurrence_date)
            FROM calendar_event_exceptions x
            WHERE x.series_id = e.id
          ), '[]'::jsonb) END,
          -- The linked student's OWN response only. Never another student's.
          'studentRsvp', (
            SELECT r.response FROM subteam_calendar_rsvps r
            WHERE r.event_id = e.id AND r.user_id = contact.member_user_id
          )
        ) AS ev
        FROM subteam_calendar_events e
        WHERE e.org_id = contact.org_id
          AND (
            (e.starts_at > now() - interval '1 day' AND e.starts_at < now() + interval '30 days')
            OR (
              e.rrule IS NOT NULL
              AND e.starts_at < now() + interval '30 days'
              AND (e.recurrence_end IS NULL OR e.recurrence_end > CURRENT_DATE - 1)
            )
          )
          AND (
            -- Whole-team events always; subteam events only for the linked
            -- student's own subteams.
            e.subteam_id IS NULL
            OR (
              contact.member_user_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM team_subteam_members sm
                WHERE sm.subteam_id = e.subteam_id
                  AND sm.user_id = contact.member_user_id
              )
            )
          )
      ) upcoming
    ), '[]'::jsonb)
  )
  INTO result
  FROM organizations o
  WHERE o.id = contact.org_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION get_parent_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_parent_view(text) TO vantage_app, vantage_worker;

-- One-click unsubscribe for parents (no users row, no session). Flips the
-- digest opt-in off and reports the org name for the confirmation page.
-- Unknown tokens -> NULL; repeat clicks stay unsubscribed and still succeed.
CREATE OR REPLACE FUNCTION parent_digest_unsubscribe(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  contact_org uuid;
  org_name text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR length(p_token) > 100 THEN
    RETURN NULL;
  END IF;

  UPDATE parent_contacts
  SET digest_opt_in = false, updated_at = now()
  WHERE unsubscribe_token = p_token
  RETURNING org_id INTO contact_org;
  IF contact_org IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT name INTO org_name FROM organizations WHERE id = contact_org;
  RETURN jsonb_build_object('orgName', COALESCE(org_name, 'your team'));
END;
$$;

REVOKE ALL ON FUNCTION parent_digest_unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parent_digest_unsubscribe(text) TO vantage_app, vantage_worker;
