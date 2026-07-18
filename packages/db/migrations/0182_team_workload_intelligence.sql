-- CD #31-34: collaborative task ownership, idle-member visibility and
-- privacy-safe, opt-in team norms. Existing build_tasks.assignee remains the
-- first display name for backward compatibility.
CREATE TABLE IF NOT EXISTS build_task_assignees (
  task_id uuid NOT NULL REFERENCES build_tasks(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignee text NOT NULL CHECK (char_length(trim(assignee)) BETWEEN 1 AND 120),
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, assignee)
);
CREATE INDEX IF NOT EXISTS build_task_assignees_org_name_idx
  ON build_task_assignees(org_id, lower(assignee));

INSERT INTO build_task_assignees(task_id,org_id,assignee,added_by)
SELECT id,org_id,trim(assignee),created_by FROM build_tasks
WHERE assignee IS NOT NULL AND trim(assignee)<>'' ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS org_ops_benchmark_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  opted_in boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE build_task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_ops_benchmark_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS build_task_assignees_member_read ON build_task_assignees;
DROP POLICY IF EXISTS build_task_assignees_member_write ON build_task_assignees;
DROP POLICY IF EXISTS org_ops_benchmark_member_read ON org_ops_benchmark_settings;
DROP POLICY IF EXISTS org_ops_benchmark_admin_write ON org_ops_benchmark_settings;
CREATE POLICY build_task_assignees_member_read ON build_task_assignees FOR SELECT TO vantage_app
  USING(is_org_member(org_id));
CREATE POLICY build_task_assignees_member_write ON build_task_assignees FOR ALL TO vantage_app
  USING(is_org_member(org_id)) WITH CHECK(is_org_member(org_id));
CREATE POLICY org_ops_benchmark_member_read ON org_ops_benchmark_settings FOR SELECT TO vantage_app
  USING(is_org_member(org_id));
CREATE POLICY org_ops_benchmark_admin_write ON org_ops_benchmark_settings FOR ALL TO vantage_app
  USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
  WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

-- Returns no organization identity or row-level data. A five-team floor keeps
-- small cohorts from making another team's hours inferable.
CREATE OR REPLACE FUNCTION get_ops_norms_benchmark(p_org_id uuid)
RETURNS TABLE(opted_in boolean,team_count integer,median_weekly_hours numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT is_org_member(p_org_id) THEN RAISE EXCEPTION 'organization access denied'; END IF;
  IF NOT COALESCE((SELECT s.opted_in FROM org_ops_benchmark_settings s WHERE s.org_id=p_org_id),false) THEN
    RETURN QUERY SELECT false,0,NULL::numeric; RETURN;
  END IF;
  RETURN QUERY WITH weekly AS (
    SELECT h.org_id,sum(extract(epoch FROM(COALESCE(h.clock_out,now())-h.clock_in))/3600)::numeric AS hours
    FROM hour_logs h JOIN org_ops_benchmark_settings s ON s.org_id=h.org_id AND s.opted_in
    WHERE h.kind IN('build','meeting') AND h.clock_in>=date_trunc('week',now()) GROUP BY h.org_id
  ), aggregate AS (
    SELECT count(*)::int teams,percentile_cont(0.5) WITHIN GROUP(ORDER BY hours)::numeric median FROM weekly
  ) SELECT true,a.teams,CASE WHEN a.teams>=5 THEN round(a.median,1) ELSE NULL::numeric END FROM aggregate a;
END $$;

REVOKE ALL ON FUNCTION get_ops_norms_benchmark(uuid) FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON build_task_assignees,org_ops_benchmark_settings TO vantage_app,vantage_worker;
GRANT EXECUTE ON FUNCTION get_ops_norms_benchmark(uuid) TO vantage_app,vantage_worker;
