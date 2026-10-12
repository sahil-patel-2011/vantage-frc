-- Send feedback (0726): the feedback button reports two kinds of note into bug_reports, a
-- problem ("Something's wrong") and an idea ("I have an idea"). Existing rows are all problems,
-- so the default keeps them as they were. An idea carries no severity.
--
-- No new table and no new policy: bug_reports_self_insert / _self_read / _platform_admin from
-- 0449 already let a person send and read their own notes and a platform admin triage all of
-- them, and 0715 already lists the table as feedback to Vantage that a view-only member may send.

ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'bug';

ALTER TABLE bug_reports DROP CONSTRAINT IF EXISTS bug_reports_kind_check;
ALTER TABLE bug_reports ADD CONSTRAINT bug_reports_kind_check CHECK (kind IN ('bug', 'idea'));

ALTER TABLE bug_reports DROP CONSTRAINT IF EXISTS bug_reports_idea_no_severity;
ALTER TABLE bug_reports ADD CONSTRAINT bug_reports_idea_no_severity CHECK (kind <> 'idea' OR severity IS NULL);

-- The /admin Feedback list: newest first, optionally one kind and/or one status. The
-- (status, created_at) index from 0449 already serves a status-only filter.
CREATE INDEX IF NOT EXISTS bug_reports_created_idx ON bug_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_kind_status_idx ON bug_reports (kind, status, created_at DESC);
