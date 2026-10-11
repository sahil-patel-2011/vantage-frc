-- Trust in the team's records: money, shop certifications, hours and lead sign-offs.
--
-- QA walked the operations pages as a student and found records anyone could write about
-- themselves. Each part below makes Postgres keep the same rule the API now states in a sentence.
--
--   1. REIMBURSEMENTS (A5-14, A5-11). A finance manager could approve and pay a claim they filed;
--      the audit log showed the same name on both sides. Now nobody approves, denies or pays their
--      own claim: someone else who manages money decides it. A claim's decision note survives the
--      filer reopening and resubmitting it, and only a finance manager can change it.
--   2. TOOL CERTIFICATIONS (A5-15). Any member could record "cleared on the band saw" for anyone,
--      including themselves, and the shop-training tables were the same. Recording, changing and
--      removing a certification or a training completion is now an owner's or admin's attestation,
--      like the lead sign-off on the guided tracks (0719). Everyone still reads the list.
--   3. HOURS (A5-03). Hours typed in by hand looked identical to clocked hours, and a mentor could
--      only delete a wrong entry. hour_logs now says how an entry was made (entry_source) and
--      carries a mentor's correction with its note. Only an owner or admin changes a session's
--      times once it is closed; a member still clocks in and out.
--   4. LEAD SIGN-OFF NOTICES (A5-16). Asking a lead to sign a step off, and the lead's answer, now
--      reach the other person's inbox. Two peer-insert policies allow exactly those rows.
--
-- Safe to re-run: policies are DROP IF EXISTS + CREATE, functions CREATE OR REPLACE, triggers
-- DROP IF EXISTS + CREATE, columns ADD COLUMN IF NOT EXISTS, constraints dropped before re-adding.

-- ---------------------------------------------------------------- 1. reimbursements

-- 0714's finance-manager policy, plus: the new row may not be the manager's own claim in a decided
-- state. Their own draft or submitted claim (approver cleared) is still theirs to file and fix, which
-- the self_* policies also allow.
DROP POLICY IF EXISTS reimbursement_requests_admin_write ON reimbursement_requests;
CREATE POLICY reimbursement_requests_admin_write ON reimbursement_requests FOR ALL TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (
    can_manage_finances(org_id)
    AND (
      member_user_id <> current_app_user_id()
      OR (status IN ('draft', 'submitted') AND approver_user_id IS NULL)
    )
  );

-- The decision note and its date are the deciding manager's words. The filer's own writes
-- (submit, withdraw, reopen, edits, receipts) keep them as they are; jobs without an app user
-- are not people deciding money and pass through.
CREATE OR REPLACE FUNCTION reimbursement_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := current_app_user_id();
BEGIN
  IF actor IS NULL OR (NEW.member_user_id <> actor AND can_manage_finances(NEW.org_id)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.decision_note IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
      RAISE EXCEPTION 'A new claim cannot carry a decision.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.decision_note IS DISTINCT FROM OLD.decision_note OR NEW.decided_at IS DISTINCT FROM OLD.decided_at THEN
    RAISE EXCEPTION 'Only someone else who manages money can change the decision on this claim.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION reimbursement_decision_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS reimbursement_requests_decision_guard ON reimbursement_requests;
CREATE TRIGGER reimbursement_requests_decision_guard
  BEFORE INSERT OR UPDATE ON reimbursement_requests
  FOR EACH ROW EXECUTE FUNCTION reimbursement_decision_guard();

-- ---------------------------------------------------------------- 2. tool certifications

DROP POLICY IF EXISTS safety_certifications_insert ON safety_certifications;
CREATE POLICY safety_certifications_insert ON safety_certifications FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND recorded_by = current_app_user_id()
  );
-- 0050 let the person who recorded a row delete it; a student could erase an expiry. Leads only.
DROP POLICY IF EXISTS safety_certifications_delete ON safety_certifications;
CREATE POLICY safety_certifications_delete ON safety_certifications FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- The training curriculum is the leads' to set.
DROP POLICY IF EXISTS safety_training_modules_member_insert ON safety_training_modules;
DROP POLICY IF EXISTS safety_training_modules_lead_insert ON safety_training_modules;
CREATE POLICY safety_training_modules_lead_insert ON safety_training_modules FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND created_by = current_app_user_id()
  );
DROP POLICY IF EXISTS safety_training_modules_member_update ON safety_training_modules;
DROP POLICY IF EXISTS safety_training_modules_lead_update ON safety_training_modules;
CREATE POLICY safety_training_modules_lead_update ON safety_training_modules FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
DROP POLICY IF EXISTS safety_training_modules_member_delete ON safety_training_modules;
DROP POLICY IF EXISTS safety_training_modules_lead_delete ON safety_training_modules;
CREATE POLICY safety_training_modules_lead_delete ON safety_training_modules FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- A completion says "this person is cleared": a lead's attestation, never a self-report.
DROP POLICY IF EXISTS safety_training_completions_member_insert ON safety_training_completions;
DROP POLICY IF EXISTS safety_training_completions_lead_insert ON safety_training_completions;
CREATE POLICY safety_training_completions_lead_insert ON safety_training_completions FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND recorded_by = current_app_user_id()
  );
DROP POLICY IF EXISTS safety_training_completions_member_update ON safety_training_completions;
DROP POLICY IF EXISTS safety_training_completions_lead_update ON safety_training_completions;
CREATE POLICY safety_training_completions_lead_update ON safety_training_completions FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
DROP POLICY IF EXISTS safety_training_completions_member_delete ON safety_training_completions;
DROP POLICY IF EXISTS safety_training_completions_lead_delete ON safety_training_completions;
CREATE POLICY safety_training_completions_lead_delete ON safety_training_completions FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- ---------------------------------------------------------------- 3. hours

-- How the entry was made. Rows from before 0723 stay 'clock': which of them were typed in can't
-- be told apart now, and guessing would mislabel a student's real clock-in.
ALTER TABLE hour_logs ADD COLUMN IF NOT EXISTS entry_source text NOT NULL DEFAULT 'clock';
ALTER TABLE hour_logs DROP CONSTRAINT IF EXISTS hour_logs_entry_source_check;
ALTER TABLE hour_logs ADD CONSTRAINT hour_logs_entry_source_check CHECK (entry_source IN ('clock', 'manual'));

-- A mentor's correction: who, when, and why (the note also records the times it replaced).
ALTER TABLE hour_logs ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hour_logs ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
ALTER TABLE hour_logs ADD COLUMN IF NOT EXISTS correction_note text;
ALTER TABLE hour_logs DROP CONSTRAINT IF EXISTS hour_logs_correction_note_check;
ALTER TABLE hour_logs ADD CONSTRAINT hour_logs_correction_note_check
  CHECK (correction_note IS NULL OR char_length(correction_note) BETWEEN 1 AND 500);
ALTER TABLE hour_logs DROP CONSTRAINT IF EXISTS hour_logs_correction_recorded;
ALTER TABLE hour_logs ADD CONSTRAINT hour_logs_correction_recorded
  CHECK ((corrected_at IS NULL) = (correction_note IS NULL));

COMMENT ON COLUMN hour_logs.entry_source IS
  'clock = clocked in and out (app, kiosk, scan); manual = typed in after the fact (0723). Set by trigger on insert.';
COMMENT ON COLUMN hour_logs.correction_note IS
  'Why an owner/admin changed this entry''s times, including the times it replaced (0723).';

-- A session that arrives already closed was typed in, not clocked, whoever sends it. After that,
-- a member may close their own open session (clock out) and link it to a calendar event; the times,
-- the source and the correction are an owner's or admin's to change.
CREATE OR REPLACE FUNCTION hour_logs_entry_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.entry_source := CASE WHEN NEW.clock_out IS NULL THEN 'clock' ELSE 'manual' END;
    NEW.corrected_by := NULL;
    NEW.corrected_at := NULL;
    NEW.correction_note := NULL;
    RETURN NEW;
  END IF;
  IF current_app_user_id() IS NULL OR has_org_role(NEW.org_id, ARRAY['owner', 'admin']::org_role[]) THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.clock_in IS DISTINCT FROM OLD.clock_in
    OR (OLD.clock_out IS NOT NULL AND NEW.clock_out IS DISTINCT FROM OLD.clock_out)
    OR NEW.entry_source IS DISTINCT FROM OLD.entry_source
    OR NEW.corrected_by IS DISTINCT FROM OLD.corrected_by
    OR NEW.corrected_at IS DISTINCT FROM OLD.corrected_at
    OR NEW.correction_note IS DISTINCT FROM OLD.correction_note THEN
    RAISE EXCEPTION 'Only an owner or admin can change the times on an hours entry.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hour_logs_entry_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS hour_logs_entry_guard ON hour_logs;
CREATE TRIGGER hour_logs_entry_guard
  BEFORE INSERT OR UPDATE ON hour_logs
  FOR EACH ROW EXECUTE FUNCTION hour_logs_entry_guard();

-- ---------------------------------------------------------------- 4. lead sign-off notices

-- The student who just asked tells each owner and admin. The row must name the student's own
-- pending request, so this cannot be used to send a lead anything else.
DROP POLICY IF EXISTS notifications_guided_signoff_requested_insert ON notifications;
CREATE POLICY notifications_guided_signoff_requested_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'guided_signoff_requested'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
        AND m.role IN ('owner', 'admin')
    )
    AND EXISTS (
      SELECT 1 FROM guided_signoffs s
      WHERE s.org_id = notifications.org_id
        AND s.user_id = current_app_user_id()
        AND s.status = 'requested'
        AND s.id::text = notifications.payload ->> 'signoffId'
    )
  );

-- The lead who just decided tells the student, about that decision only.
DROP POLICY IF EXISTS notifications_guided_signoff_decided_insert ON notifications;
CREATE POLICY notifications_guided_signoff_decided_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'guided_signoff_decided'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM guided_signoffs s
      WHERE s.org_id = notifications.org_id
        AND s.user_id = notifications.user_id
        AND s.decided_by = current_app_user_id()
        AND s.status IN ('approved', 'declined')
        AND s.id::text = notifications.payload ->> 'signoffId'
    )
  );

SELECT install_view_only_guards();
