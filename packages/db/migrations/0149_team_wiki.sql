-- Team knowledge wiki (CD #26): multi-page markdown wiki with structured handoff
-- templates. Links to decision_records / design_reviews (CD #30) so cross-season
-- "why did we choose X" answers are searchable from the same surface the FRC
-- Assistant and CAD agent retrieve via knowledge.* tools.
-- Distinct from team_knowledge (single assistant summary doc, 0105).

CREATE TABLE knowledge_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  template_kind text NOT NULL DEFAULT 'blank'
    CHECK (template_kind IN (
      'blank',
      'season_handoff',
      'subsystem',
      'role_onboarding',
      'pit_ops',
      'software',
      'cad_conventions',
      'other'
    )),
  season_year integer,
  tags text[] NOT NULL DEFAULT '{}',
  pinned boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_pages_org_slug_unique UNIQUE (org_id, slug),
  CONSTRAINT knowledge_pages_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT knowledge_pages_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT knowledge_pages_body_len CHECK (char_length(body) <= 50000)
);

CREATE INDEX knowledge_pages_org_updated_idx ON knowledge_pages(org_id, pinned DESC, updated_at DESC);
CREATE INDEX knowledge_pages_org_season_idx ON knowledge_pages(org_id, season_year DESC NULLS LAST);
CREATE INDEX knowledge_pages_org_tags_idx ON knowledge_pages USING GIN (tags);
CREATE INDEX knowledge_pages_fts_idx ON knowledge_pages
  USING GIN (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')));

CREATE TABLE knowledge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('decision', 'design_review')),
  target_id uuid NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_links_unique UNIQUE (page_id, target_type, target_id),
  CONSTRAINT knowledge_links_note_len CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX knowledge_links_org_target_idx ON knowledge_links(org_id, target_type, target_id);
CREATE INDEX knowledge_links_page_idx ON knowledge_links(page_id);

ALTER TABLE knowledge_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_pages_member_read ON knowledge_pages FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY knowledge_pages_member_insert ON knowledge_pages FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY knowledge_pages_member_update ON knowledge_pages FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY knowledge_pages_member_delete ON knowledge_pages FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]) OR created_by = current_app_user_id());

CREATE POLICY knowledge_links_member_read ON knowledge_links FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY knowledge_links_member_insert ON knowledge_links FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY knowledge_links_member_delete ON knowledge_links FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_pages, knowledge_links TO vantage_app, vantage_worker;

-- Help decision / design-review history search (CD #30) without inventing rows.
CREATE INDEX IF NOT EXISTS decision_records_fts_idx ON decision_records
  USING GIN (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(context, '') || ' ' ||
      coalesce(decision, '') || ' ' || coalesce(rationale, '') || ' ' || coalesce(notes, '')
    )
  );

CREATE INDEX IF NOT EXISTS design_reviews_fts_idx ON design_reviews
  USING GIN (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(subsystem, '') || ' ' || coalesce(notes, '')
    )
  );
