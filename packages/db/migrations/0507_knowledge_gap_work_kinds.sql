-- knowledge_gap_items.subject_kind: persist native work-item sources
-- (todo / build_task / milestone) instead of the 0242 aliases
-- (decision / subsystem / event). Existing rows are rewritten so the
-- new CHECK can be exclusive. Never invents DEMO subjects.

UPDATE knowledge_gap_items
SET subject_kind = CASE subject_kind
  WHEN 'subsystem' THEN 'build_task'
  WHEN 'decision' THEN 'todo'
  WHEN 'event' THEN 'milestone'
  ELSE subject_kind
END
WHERE subject_kind IN ('subsystem', 'decision', 'event');

ALTER TABLE knowledge_gap_items
  DROP CONSTRAINT IF EXISTS knowledge_gap_items_subject_kind_check;

ALTER TABLE knowledge_gap_items
  ADD CONSTRAINT knowledge_gap_items_subject_kind_check
  CHECK (subject_kind IN ('todo', 'build_task', 'milestone'));
