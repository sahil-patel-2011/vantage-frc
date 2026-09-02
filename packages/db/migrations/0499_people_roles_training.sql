-- "Manage people" becomes real:
--   (a) team_roles are held by a member account (holder_user_id), with the old
--       free-text holder_name kept as the display fallback for non-members;
--   (b) roles + training writes are owner/admin only (the org_role enum has no
--       mentor value — owner/admin is the mentor tier on this platform);
--   (c) safety incident edits are reporter-or-admin, matching the delete policy;
--   (d) attendance_entries.user_id (0478) is back-filled from exact name/email
--       matches so one-tap roll calls resolve to real members.
--
-- Backfills link ONLY unambiguous, exact (case-insensitive, trimmed) matches
-- against the org's own roster. Ambiguous or unmatched names stay free text —
-- nothing is guessed.

-- ---------------------------------------------------------------------------
-- (a) Roles are held by people.
-- ---------------------------------------------------------------------------

ALTER TABLE team_roles
  ADD COLUMN IF NOT EXISTS holder_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN team_roles.holder_user_id IS
  'Member account holding the role. NULL with a holder_name = held by someone outside the roster (label only).';

CREATE INDEX IF NOT EXISTS team_roles_holder_idx
  ON team_roles(org_id, holder_user_id)
  WHERE holder_user_id IS NOT NULL;

UPDATE team_roles r
SET holder_user_id = x.user_id, updated_at = now()
FROM (
  SELECT r2.id AS role_id,
         min(m.user_id::text)::uuid AS user_id,
         count(DISTINCT m.user_id) AS matches
  FROM team_roles r2
  JOIN memberships m ON m.org_id = r2.org_id
  JOIN users u ON u.id = m.user_id
  LEFT JOIN profiles p ON p.user_id = u.id
  WHERE r2.holder_user_id IS NULL
    AND r2.holder_name IS NOT NULL
    AND btrim(r2.holder_name) <> ''
    AND (
      lower(btrim(r2.holder_name)) = lower(btrim(u.name))
      OR lower(btrim(r2.holder_name)) = lower(btrim(u.email))
      OR (p.display_name IS NOT NULL AND lower(btrim(r2.holder_name)) = lower(btrim(p.display_name)))
    )
  GROUP BY r2.id
) x
WHERE x.role_id = r.id AND x.matches = 1;

-- ---------------------------------------------------------------------------
-- (b) Roles + training: everyone reads, owners/admins write.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS team_roles_member_insert ON team_roles;
DROP POLICY IF EXISTS team_roles_member_update ON team_roles;
DROP POLICY IF EXISTS team_roles_member_delete ON team_roles;
DROP POLICY IF EXISTS team_roles_admin_insert ON team_roles;
DROP POLICY IF EXISTS team_roles_admin_update ON team_roles;
DROP POLICY IF EXISTS team_roles_admin_delete ON team_roles;
CREATE POLICY team_roles_admin_insert ON team_roles FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND created_by = current_app_user_id());
CREATE POLICY team_roles_admin_update ON team_roles FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY team_roles_admin_delete ON team_roles FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

DROP POLICY IF EXISTS training_skills_member_insert ON training_skills;
DROP POLICY IF EXISTS training_skills_member_update ON training_skills;
DROP POLICY IF EXISTS training_skills_member_delete ON training_skills;
DROP POLICY IF EXISTS training_skills_admin_insert ON training_skills;
DROP POLICY IF EXISTS training_skills_admin_update ON training_skills;
DROP POLICY IF EXISTS training_skills_admin_delete ON training_skills;
CREATE POLICY training_skills_admin_insert ON training_skills FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND created_by = current_app_user_id());
CREATE POLICY training_skills_admin_update ON training_skills FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY training_skills_admin_delete ON training_skills FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

-- Certifications are sign-offs: only an owner/admin (the mentor tier) may
-- certify, and the row still records exactly who signed.
DROP POLICY IF EXISTS training_certifications_member_insert ON training_certifications;
DROP POLICY IF EXISTS training_certifications_member_update ON training_certifications;
DROP POLICY IF EXISTS training_certifications_member_delete ON training_certifications;
DROP POLICY IF EXISTS training_certifications_admin_insert ON training_certifications;
DROP POLICY IF EXISTS training_certifications_admin_update ON training_certifications;
DROP POLICY IF EXISTS training_certifications_admin_delete ON training_certifications;
CREATE POLICY training_certifications_admin_insert ON training_certifications FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND certified_by = current_app_user_id());
CREATE POLICY training_certifications_admin_update ON training_certifications FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY training_certifications_admin_delete ON training_certifications FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

-- ---------------------------------------------------------------------------
-- (c) Safety incidents: any member reports; the reporter or an owner/admin edits.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS safety_incidents_update ON safety_incidents;
CREATE POLICY safety_incidents_update ON safety_incidents FOR UPDATE TO vantage_app
  USING (reported_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- (d) Attendance marks resolve to members (column from 0478; back-fill here).
-- ---------------------------------------------------------------------------

ALTER TABLE attendance_entries
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS attendance_entries_user_idx
  ON attendance_entries(org_id, user_id)
  WHERE user_id IS NOT NULL;

UPDATE attendance_entries a
SET user_id = x.user_id
FROM (
  SELECT a2.id AS entry_id,
         min(m.user_id::text)::uuid AS user_id,
         count(DISTINCT m.user_id) AS matches
  FROM attendance_entries a2
  JOIN memberships m ON m.org_id = a2.org_id
  JOIN users u ON u.id = m.user_id
  LEFT JOIN profiles p ON p.user_id = u.id
  WHERE a2.user_id IS NULL
    AND btrim(a2.person_name) <> ''
    AND (
      lower(btrim(a2.person_name)) = lower(btrim(u.name))
      OR lower(btrim(a2.person_name)) = lower(btrim(u.email))
      OR (p.display_name IS NOT NULL AND lower(btrim(a2.person_name)) = lower(btrim(p.display_name)))
    )
  GROUP BY a2.id
) x
WHERE x.entry_id = a.id AND x.matches = 1;
