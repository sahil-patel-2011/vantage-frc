import type { PoolClient } from "@neondatabase/serverless";
import type { ScoutCalibration } from "@vantage/prediction-strategy";

/** Robot-attributed checks recorded by scouting's official-field validator. */
export async function loadScoutCalibrations(client: PoolClient, orgId: string, eventKey: string): Promise<ScoutCalibration[]> {
  const result = await client.query<{ scoutUserId: string; fieldKey: string; agreementRate: number; nSamples: number }>(
    `SELECT e.scout_user_id::text AS "scoutUserId", v.field_key AS "fieldKey",
            (count(*) FILTER (WHERE v.status='match'))::float
              / NULLIF(count(*) FILTER (WHERE v.status IN ('match','conflict')),0) AS "agreementRate",
            count(*) FILTER (WHERE v.status IN ('match','conflict'))::int AS "nSamples"
     FROM scout_entry_validations v
     JOIN match_scout_entries e ON e.id=v.entry_id AND e.org_id=v.org_id
     WHERE v.org_id=$1::uuid AND e.event_key=$2 AND v.official_source='tba'
     GROUP BY e.scout_user_id,v.field_key
     HAVING count(*) FILTER (WHERE v.status IN ('match','conflict')) >= 3`,
    [orgId, eventKey],
  );
  return result.rows.filter(row => row.agreementRate != null).map(row => ({
    scoutUserId: row.scoutUserId,
    fieldKey: row.fieldKey,
    agreementRate: Number(row.agreementRate),
    nSamples: row.nSamples,
  }));
}
