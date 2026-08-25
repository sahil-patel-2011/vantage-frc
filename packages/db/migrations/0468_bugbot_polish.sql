-- Bugbot finding lifecycle: NEW / KNOWN / FIXED across commits, and dismissals that stick.
--
-- 0439 stored a review row with a findings jsonb blob; 0440 added the Ultra tier, phase, repo,
-- and the proposed diff. Neither gives a team the thing that makes a reviewer trustworthy over a
-- season: "is this the same three findings I already looked at last week, or did we break
-- something new?" That needs findings as ROWS with a stable identity.
--
-- Identity is a fingerprint = hash(rule + file + normalised line content), computed in
-- packages/agent/src/bugbot.ts (bugbotFindingFingerprint). Deliberately NOT the line number:
-- adding an import above a finding must not resurrect it as NEW, and a dismissal must survive
-- the line moving.
--
-- Scope key groups a repo's history: 'repo:owner/name' for a connected repo, 'buffer:<path>' for
-- a pasted file. Dismissals live per (org, scope, fingerprint) so they persist across commits.
--
-- FIXED is only ever claimed for a file the scan actually re-read; the scan_files column on the
-- review row records that, so a finding in a file that a chunked scan skipped stays open rather
-- than being silently reported as fixed.
--
-- Org-scoped RLS follows packages/db/migrations/0038_community_impact.sql. Still no raw source:
-- rows carry the quoted evidence line the team already sees in the UI, nothing more.

ALTER TABLE code_bugbot_reviews
  ADD COLUMN IF NOT EXISTS github_sha text,
  ADD COLUMN IF NOT EXISTS scope_key text,
  ADD COLUMN IF NOT EXISTS new_finding_count integer NOT NULL DEFAULT 0
    CHECK (new_finding_count >= 0),
  ADD COLUMN IF NOT EXISTS known_finding_count integer NOT NULL DEFAULT 0
    CHECK (known_finding_count >= 0),
  ADD COLUMN IF NOT EXISTS fixed_finding_count integer NOT NULL DEFAULT 0
    CHECK (fixed_finding_count >= 0),
  ADD COLUMN IF NOT EXISTS dismissed_finding_count integer NOT NULL DEFAULT 0
    CHECK (dismissed_finding_count >= 0),
  -- Exactly which files this pass read, and what it refused to read and why.
  ADD COLUMN IF NOT EXISTS scan_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS skipped_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS chunk_index integer NOT NULL DEFAULT 0 CHECK (chunk_index >= 0),
  ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 1 CHECK (chunk_count >= 1),
  -- True when the scan stopped early (budget cap, cutoff, error) — the result is partial coverage.
  ADD COLUMN IF NOT EXISTS partial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partial_reason text;

CREATE INDEX IF NOT EXISTS code_bugbot_reviews_org_scope_idx
  ON code_bugbot_reviews (org_id, scope_key, created_at DESC);

COMMENT ON COLUMN code_bugbot_reviews.scan_files IS
  'Array of file paths this pass actually read. Coverage claims come from here, never from the tree.';
COMMENT ON COLUMN code_bugbot_reviews.skipped_files IS
  'Array of {path, reason} skip records so a partial scan can never read as a clean bill of health.';

-- One row per distinct finding identity per repo scope. Re-scans update it in place.
CREATE TABLE IF NOT EXISTS code_bugbot_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  fingerprint text NOT NULL,
  rule text NOT NULL,
  file_path text NOT NULL,
  line integer NOT NULL DEFAULT 1 CHECK (line >= 1),
  severity text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  source text NOT NULL DEFAULT 'model' CHECK (source IN ('local_rule', 'model')),
  finding text NOT NULL,
  evidence text NOT NULL,
  github_repo text,
  first_seen_sha text,
  last_seen_sha text,
  first_review_id uuid REFERENCES code_bugbot_reviews(id) ON DELETE SET NULL,
  last_review_id uuid REFERENCES code_bugbot_reviews(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Set when a later scan re-read the same file and the evidence was gone.
  resolved_at timestamptz,
  resolved_sha text,
  seen_count integer NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  CONSTRAINT code_bugbot_findings_fingerprint_len CHECK (char_length(fingerprint) BETWEEN 4 AND 64),
  CONSTRAINT code_bugbot_findings_scope_len CHECK (char_length(scope_key) BETWEEN 1 AND 260),
  CONSTRAINT code_bugbot_findings_finding_len CHECK (char_length(finding) BETWEEN 1 AND 1000),
  CONSTRAINT code_bugbot_findings_evidence_len CHECK (char_length(evidence) <= 400)
);

CREATE UNIQUE INDEX IF NOT EXISTS code_bugbot_findings_identity_idx
  ON code_bugbot_findings (org_id, scope_key, fingerprint);
CREATE INDEX IF NOT EXISTS code_bugbot_findings_open_idx
  ON code_bugbot_findings (org_id, scope_key, resolved_at, last_seen_at DESC);

ALTER TABLE code_bugbot_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS code_bugbot_findings_member_read ON code_bugbot_findings;
CREATE POLICY code_bugbot_findings_member_read ON code_bugbot_findings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS code_bugbot_findings_member_insert ON code_bugbot_findings;
CREATE POLICY code_bugbot_findings_member_insert ON code_bugbot_findings FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));

-- A re-scan refreshes last_seen / resolves a finding for the same team.
DROP POLICY IF EXISTS code_bugbot_findings_member_update ON code_bugbot_findings;
CREATE POLICY code_bugbot_findings_member_update ON code_bugbot_findings FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE ON code_bugbot_findings TO vantage_app, vantage_worker;

-- "We looked at this and it is fine / it is deliberate." Keyed by fingerprint, so it survives
-- the next commit, the next scan, and the line moving.
CREATE TABLE IF NOT EXISTS code_bugbot_finding_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  fingerprint text NOT NULL,
  reason text NOT NULL,
  file_path text,
  rule text,
  dismissed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT code_bugbot_dismissal_reason_len CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT code_bugbot_dismissal_scope_len CHECK (char_length(scope_key) BETWEEN 1 AND 260)
);

CREATE UNIQUE INDEX IF NOT EXISTS code_bugbot_finding_dismissals_identity_idx
  ON code_bugbot_finding_dismissals (org_id, scope_key, fingerprint);

ALTER TABLE code_bugbot_finding_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS code_bugbot_dismissals_member_read ON code_bugbot_finding_dismissals;
CREATE POLICY code_bugbot_dismissals_member_read ON code_bugbot_finding_dismissals
  FOR SELECT TO vantage_app USING (is_org_member(org_id));

DROP POLICY IF EXISTS code_bugbot_dismissals_member_insert ON code_bugbot_finding_dismissals;
CREATE POLICY code_bugbot_dismissals_member_insert ON code_bugbot_finding_dismissals
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND dismissed_by = current_app_user_id());

-- Re-dismissing the same fingerprint rewrites the reason in place (the store uses
-- INSERT ... ON CONFLICT DO UPDATE), so the UPDATE path needs its own policy and
-- grant — an INSERT policy alone makes the conflict branch fail at runtime.
DROP POLICY IF EXISTS code_bugbot_dismissals_member_update ON code_bugbot_finding_dismissals;
CREATE POLICY code_bugbot_dismissals_member_update ON code_bugbot_finding_dismissals
  FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (dismissed_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  )
  WITH CHECK (is_org_member(org_id));

-- The dismisser, or an owner/admin, can undo a dismissal so the finding comes back.
DROP POLICY IF EXISTS code_bugbot_dismissals_undo ON code_bugbot_finding_dismissals;
CREATE POLICY code_bugbot_dismissals_undo ON code_bugbot_finding_dismissals
  FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (dismissed_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON code_bugbot_finding_dismissals TO vantage_app, vantage_worker;
