-- Scan-in hours kiosk: barcode / student-ID / RFID keyboard-wedge sign-in that
-- survives a dead shop or venue network.
--
-- Community evidence (docs/COMMUNITY_DEMAND_RND.md): teams run cheap USB
-- barcode and student-ID scanners at the shop door. Those scanners are
-- keyboard-wedge devices — they simply TYPE the code into whatever field has
-- focus and press Enter. The existing kiosk (0051_build_hours.sql) only offers
-- tap-your-name tiles on an online device, so teams keep rebuilding custom
-- Raspberry Pi + Google Sheets rigs that "broke midway through the season".
--
-- Three additions, all reading/writing the existing hour_logs semantics:
--   1. member_scan_codes — a scannable identifier per member that is NOT their
--      email. Minors'-data minimalism: only owners/admins may read the org's
--      codes (the kiosk resolves scans on the server); a member may read their
--      own row so they can confirm a card is enrolled.
--   2. hour_logs.auto_closed / auto_closed_reason — the forgot-to-sign-out
--      sweep never silently credits a full overnight session; it closes the row
--      with a capped credit and flags it so a mentor corrects it by hand.
--   3. hour_policies kiosk columns — the sweep cutoff and capped credit are
--      per-org configurable, and travel_eligibility_hours is NULLABLE on
--      purpose: NULL means "this team has not set a threshold", which the UI
--      states honestly instead of inventing a number.

CREATE TABLE member_scan_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Normalized (whitespace-stripped, upper-cased) scan payload. Never an email.
  code text NOT NULL CHECK (char_length(code) BETWEEN 3 AND 64),
  code_kind text NOT NULL DEFAULT 'student_id'
    CHECK (code_kind IN ('student_id', 'barcode', 'manual')),
  -- Human label for the mentor UI ("blue lanyard card"); the code itself is masked.
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX member_scan_codes_user_idx ON member_scan_codes(org_id, user_id);

ALTER TABLE member_scan_codes ENABLE ROW LEVEL SECURITY;

-- A member may read only their own code rows; owners/admins read the whole org
-- (the kiosk device is a mentor session, so scan resolution happens under that
-- role). Only owners/admins enroll, relabel, or revoke a card.
CREATE POLICY member_scan_codes_read ON member_scan_codes FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  );
CREATE POLICY member_scan_codes_insert ON member_scan_codes FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY member_scan_codes_update ON member_scan_codes FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY member_scan_codes_delete ON member_scan_codes FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON member_scan_codes TO vantage_app, vantage_worker;

-- Forgot-to-sign-out flag on the existing hour log (0051_build_hours.sql).
ALTER TABLE hour_logs ADD COLUMN auto_closed boolean NOT NULL DEFAULT false;
ALTER TABLE hour_logs ADD COLUMN auto_closed_reason text;
CREATE INDEX hour_logs_auto_closed_idx ON hour_logs(org_id, clock_in DESC) WHERE auto_closed;

-- Per-org kiosk policy on the existing hour_policies row.
ALTER TABLE hour_policies ADD COLUMN auto_close_after_hours numeric(5, 2) NOT NULL DEFAULT 12
  CHECK (auto_close_after_hours > 0 AND auto_close_after_hours <= 168);
ALTER TABLE hour_policies ADD COLUMN auto_close_credit_hours numeric(5, 2) NOT NULL DEFAULT 4
  CHECK (auto_close_credit_hours >= 0 AND auto_close_credit_hours <= 24);
-- NULL = no travel-hours threshold configured. Do not default this to a number.
ALTER TABLE hour_policies ADD COLUMN travel_eligibility_hours numeric(7, 2)
  CHECK (travel_eligibility_hours IS NULL OR travel_eligibility_hours >= 0);

-- Idempotency ledger for kiosk scans.
--
-- A scan is a TOGGLE, so replaying one is not harmless: it clocks a student
-- straight back out (or back in). The offline path makes a lost response the
-- normal case, not the rare one — the client queues a scan whenever the fetch
-- never returns, which is exactly what happens when the shop Wi-Fi dies AFTER
-- the server already committed the row. Retries inside the outbox backoff have
-- the same hazard. Every scan therefore carries a client-generated id that is
-- kept across the online->queued fallback, and the toggle is recorded here in
-- the same transaction (withRls wraps the handler in BEGIN/COMMIT). A replay
-- finds the row, skips the toggle, and returns the ORIGINAL outcome, so
-- attendance is never invented and never double-counted.
CREATE TABLE kiosk_scan_events (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Client-generated (crypto.randomUUID) idempotency key, stable across retries.
  client_event_id text NOT NULL CHECK (char_length(client_event_id) BETWEEN 8 AND 64),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hour_log_id uuid REFERENCES hour_logs(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('in', 'out')),
  -- The replayed KioskScanResult, so a duplicate answers identically.
  occurred_at timestamptz NOT NULL,
  elapsed_hours numeric(7, 2),
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client_event_id)
);
CREATE INDEX kiosk_scan_events_recorded_idx ON kiosk_scan_events(org_id, recorded_at DESC);

ALTER TABLE kiosk_scan_events ENABLE ROW LEVEL SECURITY;

-- Mirrors hour_logs: the kiosk runs as an org member and must be able to read
-- back its own prior scan to answer a replay.
CREATE POLICY kiosk_scan_events_read ON kiosk_scan_events FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY kiosk_scan_events_insert ON kiosk_scan_events FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
-- No UPDATE policy on purpose: an idempotency record is write-once. Owners/admins
-- may prune old rows.
CREATE POLICY kiosk_scan_events_delete ON kiosk_scan_events FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, DELETE ON kiosk_scan_events TO vantage_app, vantage_worker;
