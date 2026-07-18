-- Durable, organization-scoped links between product engines. IDs are text because
-- some sources (TBA match/team keys) are natural keys while Vantage records use UUIDs.
CREATE TABLE feature_context_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN (
    'strategy_match','reference_team','cad_job','cad_artifact','build_task',
    'inventory_item','knowledge_page','sponsor','budget','fmea_failure','scout_entry'
  )),
  source_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN (
    'strategy_match','reference_team','cad_job','cad_artifact','build_task',
    'inventory_item','knowledge_page','sponsor','budget','fmea_failure','scout_entry'
  )),
  target_id text NOT NULL,
  relation text NOT NULL CHECK (relation IN (
    'informs','implements','validates','blocks','requires','documents','funds','supplies','derived_from'
  )),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_kind, source_id, target_kind, target_id, relation)
);

CREATE INDEX feature_context_links_source_idx
  ON feature_context_links(org_id, source_kind, source_id, created_at DESC);
CREATE INDEX feature_context_links_target_idx
  ON feature_context_links(org_id, target_kind, target_id, created_at DESC);

ALTER TABLE feature_context_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_context_links_member_read ON feature_context_links FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY feature_context_links_member_insert ON feature_context_links FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by=current_app_user_id());
CREATE POLICY feature_context_links_member_delete ON feature_context_links FOR DELETE TO vantage_app
  USING (created_by=current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, DELETE ON feature_context_links TO vantage_app, vantage_worker;
