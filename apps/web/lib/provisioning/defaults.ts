import type { PoolClient } from "@neondatabase/serverless";
import { currentSeasonYear } from "@vantage/game-year";
import { matchSchemaForYear, pitSchemaForYear } from "@vantage/scouting";
import { defaultDashboardLayoutForAudience } from "../dashboard/catalog";

/** Add usable defaults once; retries never replace a team's existing choices or records. */
export async function initializeTeamDefaults(client: PoolClient, orgId: string) {
  const owner = (await client.query<{ userId: string }>("SELECT user_id::text AS \"userId\" FROM memberships WHERE org_id=$1::uuid AND role='owner' ORDER BY created_at LIMIT 1", [orgId])).rows[0];
  if (!owner) throw new Error("Team owner registration is incomplete.");
  const billing = (await client.query("SELECT 1 FROM org_billing WHERE org_id=$1::uuid LIMIT 1", [orgId])).rows[0];
  if (!billing) throw new Error("Team settings are incomplete.");
  const year = currentSeasonYear();
  await client.query("BEGIN");
  try {
    for (const type of ["match", "pit"] as const) {
      const schema = type === "match" ? matchSchemaForYear(year) : pitSchemaForYear(year);
      await client.query(`INSERT INTO scout_schemas(org_id,year,type,version,schema,created_by)
        SELECT $1::uuid,$2,$3::scout_schema_type,1,$4::jsonb,$5::uuid
        WHERE NOT EXISTS(SELECT 1 FROM scout_schemas WHERE org_id=$1::uuid AND year=$2 AND type=$3::scout_schema_type)
        ON CONFLICT(org_id,year,type,version) DO NOTHING`, [orgId, year, type, JSON.stringify(schema), owner.userId]);
    }
    for (const name of ["Registration", "Robot parts", "Tools and equipment", "Travel", "Outreach", "Other"]) {
      await client.query("INSERT INTO finance_categories(org_id,season_year,name) VALUES($1::uuid,$2,$3) ON CONFLICT(org_id,season_year,name) DO NOTHING", [orgId, year, name]);
    }
    await client.query(`INSERT INTO dashboards(org_id,owner_user_id,name,scope,is_active,layout,created_by)
      SELECT $1::uuid,$2::uuid,'My work','personal',true,$3::jsonb,$2::uuid
      WHERE NOT EXISTS(SELECT 1 FROM dashboards WHERE org_id=$1::uuid AND owner_user_id=$2::uuid AND scope='personal')`, [orgId, owner.userId, JSON.stringify(defaultDashboardLayoutForAudience("student"))]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
