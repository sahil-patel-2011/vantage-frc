-- Close the student-erasure hole 0050 left on safety_incidents.
-- A near-miss log is team history: only owner/admin may delete. The app layer
-- already refuses reporter deletes; this policy makes RLS match.

ALTER TABLE safety_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS safety_incidents_delete ON safety_incidents;

CREATE POLICY safety_incidents_delete ON safety_incidents
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON safety_incidents TO vantage_app, vantage_worker;
