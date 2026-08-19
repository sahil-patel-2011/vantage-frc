-- CD #27: submitted graduation exit interviews write a season-handoff wiki page.
-- knowledge_page_id is optional; drafts stay capture-only. Deleting the interview
-- does not delete the wiki page (institutional knowledge stays).
-- Composite FK keeps the page in the same org (0260 id+org uniqueness).

ALTER TABLE exit_interview_responses
  ADD COLUMN IF NOT EXISTS knowledge_page_id uuid;

ALTER TABLE exit_interview_responses
  DROP CONSTRAINT IF EXISTS exit_interview_responses_knowledge_page_id_fkey;
ALTER TABLE exit_interview_responses
  DROP CONSTRAINT IF EXISTS exit_interview_responses_knowledge_page_org_fk;
ALTER TABLE exit_interview_responses
  ADD CONSTRAINT exit_interview_responses_knowledge_page_org_fk
  FOREIGN KEY (knowledge_page_id, org_id) REFERENCES knowledge_pages(id, org_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exit_interview_responses_wiki_idx
  ON exit_interview_responses (org_id, knowledge_page_id)
  WHERE knowledge_page_id IS NOT NULL;
