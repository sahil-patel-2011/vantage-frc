-- Optional scouting voice notes + STT. Transcripts attach as notes and can optionally
-- fill custom form fields via explicit Apply to form. Org + user opt-in with versioned privacy consent.
-- Audio kind + scout_media.transcript arrive via 0259_scout_voice_audio.sql.

CREATE TABLE scout_voice_org_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  consent_ack_version text,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scout_voice_user_prefs (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  consent_ack_version text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE scout_voice_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  match_key text,
  team_key text NOT NULL,
  entry_type text NOT NULL DEFAULT 'match'
    CHECK (entry_type IN ('match', 'pit')),
  entry_client_id text,
  entry_id uuid,
  media_client_id text,
  transcript text NOT NULL,
  stt_source text NOT NULL DEFAULT 'browser'
    CHECK (stt_source IN ('browser', 'cloud', 'manual')),
  consent_ack_version text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_voice_notes_org_event_idx
  ON scout_voice_notes(org_id, event_key, created_at DESC);
CREATE INDEX scout_voice_notes_entry_client_idx
  ON scout_voice_notes(org_id, entry_client_id)
  WHERE entry_client_id IS NOT NULL;

ALTER TABLE scout_voice_org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_voice_user_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_voice_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_voice_org_settings_member_read ON scout_voice_org_settings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_voice_org_settings_admin_write ON scout_voice_org_settings FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by = current_app_user_id());
CREATE POLICY scout_voice_org_settings_admin_update ON scout_voice_org_settings FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_voice_org_settings_admin_delete ON scout_voice_org_settings FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY scout_voice_user_prefs_self_read ON scout_voice_user_prefs FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY scout_voice_user_prefs_admin_read ON scout_voice_user_prefs FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_voice_user_prefs_self_insert ON scout_voice_user_prefs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY scout_voice_user_prefs_self_update ON scout_voice_user_prefs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY scout_voice_user_prefs_self_delete ON scout_voice_user_prefs FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY scout_voice_notes_member_read ON scout_voice_notes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_voice_notes_member_insert ON scout_voice_notes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY scout_voice_notes_author_update ON scout_voice_notes FOR UPDATE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_voice_notes_author_delete ON scout_voice_notes FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_voice_org_settings, scout_voice_user_prefs, scout_voice_notes
  TO vantage_app, vantage_worker;
