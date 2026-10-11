-- AI review of each pull request on a team's connected GitHub repo, and a record of the repo's
-- robot code that Ask AI and the Build tools read for context.
--
-- 0112 connected one repo per team for read-only context. This adds:
--   * github_pr_reviews: one row per (repo, PR, head commit). A review is metered AI run with
--     the team's own key (feature 'coding', the same as Bugbot's subscription tier), grounded so
--     every finding quotes a line of the PR's diff. Nothing is ever posted back to GitHub.
--   * github_code_index: a map of the repo built without AI (subsystems, commands, constants,
--     vendor libraries, WPILib version) at a known commit. Rebuilt on demand and on a push to
--     the default branch.
--   * Automatic reviews: an owner or admin turns them on; Vantage registers a repo webhook with
--     a per-team secret. The webhook URL carries an opaque per-team token; the only way from
--     that token to a team is github_pr_webhook_target(), and the delivery must still carry a
--     valid HMAC signed with that team's secret before anything is written.
--
-- A webhook has no signed-in person, so writes made because of one run under RLS as the
-- owner/admin who turned automatic reviews on (reviews_enabled_by). If they leave the team,
-- RLS refuses and the review waits for someone to press Review.

ALTER TABLE github_connections
  ADD COLUMN IF NOT EXISTS pr_reviews_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviews_enabled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS webhook_token text,
  ADD COLUMN IF NOT EXISTS webhook_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS webhook_id bigint,
  ADD COLUMN IF NOT EXISTS webhook_last_delivery_at timestamptz;

ALTER TABLE github_connections
  DROP CONSTRAINT IF EXISTS github_connections_webhook_token_shape;
ALTER TABLE github_connections
  ADD CONSTRAINT github_connections_webhook_token_shape
  CHECK (webhook_token IS NULL OR webhook_token ~ '^[A-Za-z0-9_-]{43}$');

CREATE UNIQUE INDEX IF NOT EXISTS github_connections_webhook_token_idx
  ON github_connections(webhook_token)
  WHERE webhook_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS github_pr_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_full_name text NOT NULL CHECK (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  pr_number integer NOT NULL CHECK (pr_number > 0),
  head_sha text NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  base_ref text,
  title text NOT NULL DEFAULT '',
  author_login text,
  html_url text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'skipped')),
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'webhook')),
  summary text,
  risk text CHECK (risk IS NULL OR risk IN ('low', 'medium', 'high')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array'),
  files_changed integer NOT NULL DEFAULT 0 CHECK (files_changed >= 0),
  files_reviewed integer NOT NULL DEFAULT 0 CHECK (files_reviewed >= 0),
  additions integer NOT NULL DEFAULT 0 CHECK (additions >= 0),
  deletions integer NOT NULL DEFAULT 0 CHECK (deletions >= 0),
  error text,
  requested_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, repo_full_name, pr_number, head_sha)
);

CREATE INDEX IF NOT EXISTS github_pr_reviews_org_recent_idx
  ON github_pr_reviews(org_id, updated_at DESC);

ALTER TABLE github_pr_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS github_pr_reviews_member_read ON github_pr_reviews;
CREATE POLICY github_pr_reviews_member_read ON github_pr_reviews
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Owners, admins and team members can ask for a review; a viewer only reads (0715 also
-- refuses viewer writes on every org table).
DROP POLICY IF EXISTS github_pr_reviews_member_insert ON github_pr_reviews;
CREATE POLICY github_pr_reviews_member_insert ON github_pr_reviews
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]));

DROP POLICY IF EXISTS github_pr_reviews_member_update ON github_pr_reviews;
CREATE POLICY github_pr_reviews_member_update ON github_pr_reviews
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]));

DROP POLICY IF EXISTS github_pr_reviews_admin_delete ON github_pr_reviews;
CREATE POLICY github_pr_reviews_admin_delete ON github_pr_reviews
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON github_pr_reviews TO vantage_app, vantage_worker;

CREATE TABLE IF NOT EXISTS github_code_index (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  repo_full_name text NOT NULL CHECK (repo_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  ref text NOT NULL,
  head_sha text NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  code_map jsonb NOT NULL CHECK (jsonb_typeof(code_map) = 'object'),
  generated_by uuid REFERENCES users(id),
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE github_code_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS github_code_index_member_read ON github_code_index;
CREATE POLICY github_code_index_member_read ON github_code_index
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS github_code_index_member_write ON github_code_index;
CREATE POLICY github_code_index_member_write ON github_code_index
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]));

DROP POLICY IF EXISTS github_code_index_member_update ON github_code_index;
CREATE POLICY github_code_index_member_update ON github_code_index
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[]));

DROP POLICY IF EXISTS github_code_index_admin_delete ON github_code_index;
CREATE POLICY github_code_index_admin_delete ON github_code_index
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON github_code_index TO vantage_app, vantage_worker;

-- The webhook's only way in. Knowing a 43-character random token returns that one team's
-- routing row; the handler then verifies the delivery's HMAC with the decrypted secret before
-- doing anything. Callable with no signed-in person (app.user_id empty), which is exactly when
-- every table policy above refuses.
CREATE OR REPLACE FUNCTION github_pr_webhook_target(p_token text)
RETURNS TABLE (
  org_id uuid,
  acting_user_id uuid,
  repo_full_name text,
  default_branch text,
  webhook_secret_encrypted text,
  pr_reviews_enabled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.org_id,
         c.reviews_enabled_by,
         c.default_repo_full_name,
         c.default_repo_default_branch,
         c.webhook_secret_encrypted,
         c.pr_reviews_enabled
    FROM github_connections c
   WHERE p_token ~ '^[A-Za-z0-9_-]{43}$'
     AND c.webhook_token = p_token
     AND c.disabled_at IS NULL
     AND c.status <> 'disconnected'
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION github_pr_webhook_target(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION github_pr_webhook_target(text) TO vantage_app, vantage_worker;

COMMENT ON FUNCTION github_pr_webhook_target(text) IS
  'GitHub webhook routing: opaque per-team token -> org, acting user and encrypted webhook '
  'secret. The caller must verify X-Hub-Signature-256 before writing anything.';

-- Records when the last verified delivery arrived, for the "last heard from GitHub" line.
CREATE OR REPLACE FUNCTION github_pr_webhook_touch(p_token text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE github_connections
     SET webhook_last_delivery_at = now()
   WHERE p_token ~ '^[A-Za-z0-9_-]{43}$'
     AND webhook_token = p_token
$$;
REVOKE ALL ON FUNCTION github_pr_webhook_touch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION github_pr_webhook_touch(text) TO vantage_app, vantage_worker;

SELECT install_view_only_guards();
