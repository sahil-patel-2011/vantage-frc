-- Hours self-view: student-visible own-hours read surface, locked kiosk mode
-- device registry, and a consent gate blocking biometric clock-in for minors.
-- Reads existing hour_logs (0051_build_hours.sql) for the member's own totals;
-- these tables hold only the new kiosk + consent state this feature adds.

CREATE TABLE hours_self_view_kiosk_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_label text NOT NULL CHECK (char_length(device_label) BETWEEN 1 AND 120),
  is_locked boolean NOT NULL DEFAULT true,
  pin_hash text,
  last_active_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hours_self_view_kiosk_sessions_org_idx ON hours_self_view_kiosk_sessions(org_id, created_at DESC);

CREATE TABLE hours_self_view_biometric_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_minor boolean NOT NULL DEFAULT true,
  consent_status text NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN ('pending', 'granted', 'denied')),
  guardian_name text,
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX hours_self_view_biometric_consents_org_idx ON hours_self_view_biometric_consents(org_id);

ALTER TABLE hours_self_view_kiosk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hours_self_view_biometric_consents ENABLE ROW LEVEL SECURITY;

-- Kiosk device registry: every member may see which kiosks are locked/active;
-- only owners/admins may register, relock, or remove a kiosk device.
CREATE POLICY hours_self_view_kiosk_sessions_member_read ON hours_self_view_kiosk_sessions
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY hours_self_view_kiosk_sessions_member_insert ON hours_self_view_kiosk_sessions
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]) AND created_by = current_app_user_id());
CREATE POLICY hours_self_view_kiosk_sessions_member_update ON hours_self_view_kiosk_sessions
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY hours_self_view_kiosk_sessions_member_delete ON hours_self_view_kiosk_sessions
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- Biometric consent gate: a member reads their own record (guardians/admins read all
-- to audit the minor gate); a member may only insert/update their own consent record.
CREATE POLICY hours_self_view_biometric_consents_member_read ON hours_self_view_biometric_consents
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY hours_self_view_biometric_consents_member_insert ON hours_self_view_biometric_consents
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
    AND recorded_by = current_app_user_id()
  );
CREATE POLICY hours_self_view_biometric_consents_member_update ON hours_self_view_biometric_consents
  FOR UPDATE TO vantage_app
  USING (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (is_org_member(org_id));
CREATE POLICY hours_self_view_biometric_consents_member_delete ON hours_self_view_biometric_consents
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON hours_self_view_kiosk_sessions, hours_self_view_biometric_consents
  TO vantage_app, vantage_worker;
