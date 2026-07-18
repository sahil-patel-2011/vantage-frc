-- CD #37: inventory knowledge capture from the team's de-facto parts expert.
ALTER TABLE knowledge_pages DROP CONSTRAINT IF EXISTS knowledge_pages_template_kind_check;
ALTER TABLE knowledge_pages ADD CONSTRAINT knowledge_pages_template_kind_check CHECK(template_kind IN(
  'blank','season_handoff','subsystem','role_onboarding','pit_ops','software','cad_conventions','inventory_handoff','other'
));
