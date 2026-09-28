-- Sharing is enabled by default, including existing match reports (operator decision 2026-09-27).
-- Private tables keep their original RLS. Only the constrained projection below crosses teams.
CREATE TABLE org_scouting_sharing (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO org_scouting_sharing(org_id) SELECT id FROM organizations;
ALTER TABLE org_scouting_sharing ENABLE ROW LEVEL SECURITY;
CREATE POLICY scouting_sharing_read ON org_scouting_sharing FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY scouting_sharing_write ON org_scouting_sharing FOR ALL TO vantage_app
  USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
  WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND updated_by=current_app_user_id());
CREATE POLICY scouting_sharing_worker ON org_scouting_sharing TO vantage_worker USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON org_scouting_sharing TO vantage_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON org_scouting_sharing TO vantage_worker;

-- No free text, identities, notes, private metadata, media or action histories cross this boundary.
-- Selections must match the versioned form's options. Malformed historical values fail closed.
CREATE FUNCTION shared_scout_payload(payload jsonb, definition jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_object_agg(f->>'key', payload->(f->>'key')), '{}'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(definition->'fields')='array' THEN definition->'fields' ELSE '[]'::jsonb END) f
  WHERE f->>'key' IS NOT NULL
    AND f->>'key' !~* '(^_|scout|user|email|name|note|comment|identity|contact|phone|address|private)'
    AND COALESCE(f->>'label','') !~* '(scout|email|name|note|comment|identity|contact|phone|address|private)'
    AND (
      (f->>'type' IN ('number','counter','timer','rating','slider','field_position') AND jsonb_typeof(payload->(f->>'key'))='number')
      OR (f->>'type'='boolean' AND jsonb_typeof(payload->(f->>'key'))='boolean')
      OR (f->>'type' IN ('select','dropdown','multiple_choice','drivetrain_type')
        AND jsonb_typeof(payload->(f->>'key'))='string'
        AND jsonb_typeof(f->'options')='array' AND (f->'options') @> jsonb_build_array(payload->(f->>'key')))
      OR (f->>'type'='multi_select' AND jsonb_typeof(payload->(f->>'key'))='array'
        AND jsonb_typeof(f->'options')='array' AND (f->'options') @> (payload->(f->>'key')))
      OR (f->>'type' IN ('auto_path','field_position') AND jsonb_typeof(payload->(f->>'key'))='array'
        AND NOT jsonb_path_exists(payload->(f->>'key'), '$[*] ? (@.type() != "number")'))
    )
$$;
REVOKE ALL ON FUNCTION shared_scout_payload(jsonb,jsonb) FROM PUBLIC;

CREATE FUNCTION get_shared_scout_observations(viewer_org uuid, robot text, event text)
RETURNS TABLE(source_org_id uuid, source_team_number integer, schema_id uuid, schema_version integer,
  match_key text, event_key text, confidence text, payload jsonb, fields jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.is_org_member(viewer_org) THEN RAISE EXCEPTION 'Organization access denied' USING ERRCODE='42501'; END IF;
  IF robot !~ '^frc[0-9]+[a-z]?$' OR event IS NULL OR length(event)>80 THEN
    RAISE EXCEPTION 'A robot and event are required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT e.org_id, o.team_number, s.id, s.version, e.match_key, e.event_key, e.confidence::text, projected.value,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('key',f->>'key','label',f->>'label','type',f->>'type',
      'config',jsonb_build_object(
        'gridCols',CASE WHEN jsonb_typeof(f#>'{config,gridCols}')='number' THEN f#>'{config,gridCols}' ELSE NULL END,
        'gridRows',CASE WHEN jsonb_typeof(f#>'{config,gridRows}')='number' THEN f#>'{config,gridRows}' ELSE NULL END))), '[]'::jsonb)
       FROM jsonb_array_elements(s.schema->'fields') f WHERE projected.value ? (f->>'key'))
  FROM public.match_scout_entries e
  JOIN public.organizations o ON o.id=e.org_id
  JOIN public.scout_schemas s ON s.id=e.schema_id AND s.org_id=e.org_id
  LEFT JOIN public.org_scouting_sharing preferences ON preferences.org_id=e.org_id
  CROSS JOIN LATERAL (SELECT public.shared_scout_payload(e.payload,s.schema) AS value) projected
  WHERE e.org_id<>viewer_org AND e.team_key=robot AND e.event_key=event
    AND COALESCE(preferences.enabled,true) AND projected.value<>'{}'::jsonb
  ORDER BY e.org_id,s.id,e.match_key,e.id LIMIT 2001;
END
$$;
REVOKE ALL ON FUNCTION get_shared_scout_observations(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_shared_scout_observations(uuid,text,text) TO vantage_app;
CREATE INDEX match_scout_network_subject_idx ON match_scout_entries(team_key,event_key,org_id);
SELECT install_recovery_capture();
