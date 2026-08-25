-- Youth-protection constraints for org chat (FIRST YPP "second adult" practice).
--
-- Vantage shipped org DMs with no adult-visibility rule and no audit trail. That is the exact
-- configuration school districts ban Slack/Discord over. This migration makes the safe shape the
-- DEFAULT and enforces it in the database, not in policy prose:
--   * org_chat_policy.dm_mode defaults to 'supervised'
--   * org_conversation_supervisors records the second adult added to an adult<->youth DM
--
-- Adult/youth is derived from profiles.team_role (0028_profile_onboarding): mentor/coach/parent
-- are adults; student, 'other', and unset are treated as youth. ROLE, NOT AGE, is the signal we
-- actually hold -- profiles.date_of_birth exists but is self-reported, optional in practice, and
-- readable only by the profile owner, so it is deliberately NOT used here. See
-- docs/YOUTH_PROTECTION.md for exactly what this does and does not guarantee.

CREATE TABLE org_chat_policy (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  dm_mode text NOT NULL DEFAULT 'supervised'
    CHECK (dm_mode IN ('open', 'supervised', 'disabled')),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_chat_policy ENABLE ROW LEVEL SECURITY;

-- Every member may READ the policy: both parties in a supervised DM have to be able to see the
-- rule they are being held to. Only owners/admins may change it.
CREATE POLICY org_chat_policy_member_read ON org_chat_policy FOR SELECT TO vantage_app
  USING (is_org_member(org_id) OR is_platform_admin());
CREATE POLICY org_chat_policy_admin_insert ON org_chat_policy FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY org_chat_policy_admin_update ON org_chat_policy FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE TABLE org_conversation_supervisors (
  conversation_id uuid NOT NULL REFERENCES org_conversations(id) ON DELETE CASCADE,
  supervisor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'ypp_two_adult_rule',
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, supervisor_user_id)
);

CREATE INDEX org_conversation_supervisors_org_idx
  ON org_conversation_supervisors(org_id, added_at DESC);
CREATE INDEX org_conversation_supervisors_user_idx
  ON org_conversation_supervisors(supervisor_user_id, conversation_id);

ALTER TABLE org_conversation_supervisors ENABLE ROW LEVEL SECURITY;

-- Anyone who can see the conversation can see WHO is supervising it and why. A supervised room
-- the participants cannot inspect would be surveillance, not youth protection.
CREATE POLICY org_conversation_supervisors_read ON org_conversation_supervisors FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND can_access_org_conversation(conversation_id));
CREATE POLICY org_conversation_supervisors_insert ON org_conversation_supervisors FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_conversations c
      WHERE c.id = conversation_id
        AND c.org_id = org_conversation_supervisors.org_id
        AND c.kind = 'dm'
        AND (c.created_by = current_app_user_id() OR can_access_org_conversation(c.id))
    )
  );

-- Deliberately no UPDATE/DELETE grant for the request role: a supervision record is append-only,
-- so neither party in a supervised DM can quietly remove the second adult.
GRANT SELECT, INSERT, UPDATE ON org_chat_policy TO vantage_app;
GRANT SELECT, INSERT ON org_conversation_supervisors TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_chat_policy, org_conversation_supervisors TO vantage_worker;

-- profiles is self-read-only (0001_roles_and_rls), so request code cannot see a teammate's
-- team_role. This returns ONLY the adult/youth classification, only to a fellow org member,
-- which is the minimum disclosure the two-adult rule requires.
CREATE OR REPLACE FUNCTION org_member_chat_class(p_org_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT (is_org_member(p_org_id) OR is_platform_admin()) THEN NULL
    WHEN NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.org_id = p_org_id AND m.user_id = p_user_id
    ) THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = p_user_id AND p.team_role IN ('mentor','coach','parent')
    ) THEN 'adult'
    ELSE 'youth'
  END
$$;

-- Owner/admin members who are ALSO classified adults: the only people who can serve as the
-- second adult. A student team captain with the 'admin' org role is intentionally excluded.
CREATE OR REPLACE FUNCTION org_adult_admins(p_org_id uuid)
RETURNS TABLE (user_id uuid, name text, email text, member_role text, member_since timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id,
         COALESCE(u.name, 'Member') AS name,
         u.email,
         m.role::text AS member_role,
         m.created_at AS member_since
  FROM memberships m
  INNER JOIN users u ON u.id = m.user_id
  INNER JOIN profiles p ON p.user_id = m.user_id
  WHERE (is_org_member(p_org_id) OR is_platform_admin())
    AND m.org_id = p_org_id
    AND m.role IN ('owner','admin')
    AND p.team_role IN ('mentor','coach','parent')
  ORDER BY (m.role = 'owner') DESC, m.created_at ASC, m.user_id ASC
$$;

-- Child-safety export: an owner/admin can retrieve the DM history of one named member.
-- Private conversations are otherwise invisible to admins by RLS, so this is the single,
-- audited hole -- every call writes an export_audit_events row (0012_export_center).
-- Soft-deleted messages are returned WITH their body and a deletion timestamp: for a
-- safeguarding record, "deleted" must not mean "gone".
CREATE OR REPLACE FUNCTION org_member_dm_export(p_org_id uuid, p_member_user_id uuid)
RETURNS TABLE (
  conversation_id uuid,
  message_id uuid,
  sent_at timestamptz,
  deleted_at timestamptz,
  author_user_id uuid,
  author_name text,
  author_email text,
  body text,
  counterparties text,
  supervisors text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.conversation_id,
    m.id AS message_id,
    m.created_at AS sent_at,
    m.deleted_at,
    m.author_user_id,
    COALESCE(au.name, 'Member') AS author_name,
    au.email AS author_email,
    m.body,
    (
      SELECT COALESCE(string_agg(COALESCE(pu.name, 'Member'), ', ' ORDER BY lower(pu.name)), '')
      FROM org_conversation_participants p
      INNER JOIN users pu ON pu.id = p.user_id
      WHERE p.conversation_id = m.conversation_id
        AND p.user_id <> p_member_user_id
        AND NOT EXISTS (
          SELECT 1 FROM org_conversation_supervisors s
          WHERE s.conversation_id = p.conversation_id AND s.supervisor_user_id = p.user_id
        )
    ) AS counterparties,
    (
      SELECT COALESCE(string_agg(COALESCE(su.name, 'Member'), ', ' ORDER BY lower(su.name)), '')
      FROM org_conversation_supervisors s
      INNER JOIN users su ON su.id = s.supervisor_user_id
      WHERE s.conversation_id = m.conversation_id
    ) AS supervisors
  FROM org_messages m
  INNER JOIN org_conversations c ON c.id = m.conversation_id
  LEFT JOIN users au ON au.id = m.author_user_id
  WHERE has_org_role(p_org_id, ARRAY['owner','admin']::org_role[])
    AND c.org_id = p_org_id
    AND c.kind = 'dm'
    AND EXISTS (
      SELECT 1 FROM memberships mm
      WHERE mm.org_id = p_org_id AND mm.user_id = p_member_user_id
    )
    AND EXISTS (
      SELECT 1 FROM org_conversation_participants p
      WHERE p.conversation_id = c.id AND p.user_id = p_member_user_id
    )
  ORDER BY m.conversation_id, m.created_at ASC
$$;

REVOKE ALL ON FUNCTION org_member_chat_class(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION org_adult_admins(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION org_member_dm_export(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_member_chat_class(uuid, uuid), org_adult_admins(uuid),
  org_member_dm_export(uuid, uuid) TO vantage_app, vantage_worker;
