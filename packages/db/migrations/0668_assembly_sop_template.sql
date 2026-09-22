-- Shop SOP wiki template: torque / Loctite / helper notes CAD cannot know.
ALTER TABLE knowledge_pages DROP CONSTRAINT IF EXISTS knowledge_pages_template_kind_check;
ALTER TABLE knowledge_pages ADD CONSTRAINT knowledge_pages_template_kind_check CHECK(template_kind IN(
  'blank','season_handoff','season_playbook','subsystem','role_onboarding','pit_ops','software','cad_conventions','inventory_handoff','assembly_sop','other'
));

ALTER TABLE knowledge_capture_drafts DROP CONSTRAINT IF EXISTS knowledge_capture_drafts_template_kind_check;
ALTER TABLE knowledge_capture_drafts ADD CONSTRAINT knowledge_capture_drafts_template_kind_check CHECK(template_kind IN(
  'blank','season_handoff','season_playbook','subsystem','role_onboarding','pit_ops','software','cad_conventions','inventory_handoff','assembly_sop','other'
));
