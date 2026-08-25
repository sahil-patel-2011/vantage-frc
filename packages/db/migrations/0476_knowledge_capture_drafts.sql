-- Capture-from-work knowledge drafts (COMMUNITY_DEMAND_RND: "documentation and
-- institutional memory as a byproduct of work"). Finished work proposes a wiki page:
-- an ACCEPTED decision_record (0101), a RESOLVED/CLOSED incident_report (0121), or a
-- RESOLVED pit_repair_triage_report (0210).
--
-- NOTHING IS EVER AUTO-PUBLISHED. A row here becomes a knowledge_pages (0149) row only
-- when a human presses Approve on /knowledge-drafts; approving stamps reviewed_by and
-- knowledge_page_id. That is also why this is a SEPARATE table rather than a status
-- column on knowledge_pages: knowledge_pages is what wiki search and the assistant's
-- knowledge.* tools read, and an unapproved draft must never appear there.
--
-- The proposed body is assembled from text ALREADY PRESENT on the source row plus fixed
-- section headings. Sections with nothing recorded are omitted, never filled in with a
-- placeholder, and a source too thin to say anything produces no draft row at all.
--
-- knowledge_page_id uses the composite (id, org_id) FK shape from 0438/0260 so an
-- approved draft can never point at another org's page; deleting the page keeps the
-- draft row (the capture history stays honest) and just clears the pointer.

CREATE TABLE knowledge_capture_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_kind text NOT NULL
    CHECK (source_kind IN ('decision_record', 'incident_report', 'pit_repair_triage')),
  source_id uuid NOT NULL,
  proposed_title text NOT NULL,
  proposed_slug text NOT NULL,
  proposed_body text NOT NULL DEFAULT '',
  template_kind text NOT NULL DEFAULT 'other'
    CHECK (template_kind IN (
      'blank',
      'season_handoff',
      'season_playbook',
      'subsystem',
      'role_onboarding',
      'pit_ops',
      'software',
      'cad_conventions',
      'inventory_handoff',
      'other'
    )),
  season_year integer,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'dismissed')),
  knowledge_page_id uuid,
  dismissed_reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One source produces at most one draft, so re-running "generate" is idempotent and a
  -- dismissed source does not come back as a fresh candidate.
  CONSTRAINT knowledge_capture_drafts_source_unique UNIQUE (org_id, source_kind, source_id),
  CONSTRAINT knowledge_capture_drafts_title_len
    CHECK (char_length(proposed_title) BETWEEN 1 AND 200),
  -- Same slug grammar as knowledge_pages (0149) so an approved draft can be inserted
  -- there without rewriting the slug.
  CONSTRAINT knowledge_capture_drafts_slug_format
    CHECK (proposed_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT knowledge_capture_drafts_body_len
    CHECK (char_length(proposed_body) <= 50000),
  CONSTRAINT knowledge_capture_drafts_reason_len
    CHECK (dismissed_reason IS NULL OR char_length(dismissed_reason) <= 500),
  CONSTRAINT knowledge_capture_drafts_dismissed_reason_required
    CHECK (status <> 'dismissed' OR dismissed_reason IS NOT NULL)
);

ALTER TABLE knowledge_capture_drafts
  ADD CONSTRAINT knowledge_capture_drafts_knowledge_page_org_fk
  FOREIGN KEY (knowledge_page_id, org_id) REFERENCES knowledge_pages(id, org_id) ON DELETE SET NULL;

CREATE INDEX knowledge_capture_drafts_org_status_idx
  ON knowledge_capture_drafts(org_id, status, created_at DESC);
CREATE INDEX knowledge_capture_drafts_org_source_idx
  ON knowledge_capture_drafts(org_id, source_kind, source_id);
CREATE INDEX knowledge_capture_drafts_page_idx
  ON knowledge_capture_drafts(org_id, knowledge_page_id)
  WHERE knowledge_page_id IS NOT NULL;

ALTER TABLE knowledge_capture_drafts ENABLE ROW LEVEL SECURITY;

-- Any org member may generate, edit, approve, or dismiss a draft: the review queue is a
-- shared surface and approving only writes a wiki page the same member could have
-- written by hand.
CREATE POLICY knowledge_capture_drafts_member_read ON knowledge_capture_drafts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY knowledge_capture_drafts_member_insert ON knowledge_capture_drafts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY knowledge_capture_drafts_member_update ON knowledge_capture_drafts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY knowledge_capture_drafts_member_delete ON knowledge_capture_drafts FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_capture_drafts TO vantage_app, vantage_worker;
