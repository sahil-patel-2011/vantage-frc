-- Decision Search: semantic search index over decisions, design reviews, and notebook entries.
-- decision_search_queries logs each search run (query text + AI-ranked results) so the team can
-- revisit prior searches; decision_search_documents is a lightweight per-org index of searchable
-- source records (decision/design-review/notebook entry) that the query step ranks against.

CREATE TABLE decision_search_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_kind text NOT NULL
    CHECK (source_kind IN ('decision', 'design_review', 'notebook_entry')),
  source_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  season_year integer NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  indexed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_kind, source_id)
);
CREATE INDEX decision_search_documents_org_season_idx
  ON decision_search_documents(org_id, season_year, created_at DESC);

ALTER TABLE decision_search_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY decision_search_documents_member_read ON decision_search_documents FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY decision_search_documents_member_insert ON decision_search_documents FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND indexed_by = current_app_user_id());
CREATE POLICY decision_search_documents_member_update ON decision_search_documents FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY decision_search_documents_member_delete ON decision_search_documents FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON decision_search_documents TO vantage_app, vantage_worker;

CREATE TABLE decision_search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  query_text text NOT NULL,
  result_document_ids uuid[] NOT NULL DEFAULT '{}',
  result_summary text,
  searched_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decision_search_queries_org_season_idx
  ON decision_search_queries(org_id, season_year, created_at DESC);

ALTER TABLE decision_search_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY decision_search_queries_member_read ON decision_search_queries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY decision_search_queries_member_insert ON decision_search_queries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND searched_by = current_app_user_id());
CREATE POLICY decision_search_queries_member_update ON decision_search_queries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY decision_search_queries_member_delete ON decision_search_queries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON decision_search_queries TO vantage_app, vantage_worker;
