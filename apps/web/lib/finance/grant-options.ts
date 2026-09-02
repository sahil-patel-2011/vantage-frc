/**
 * The grant list every expense form offers when tagging spend to a grant (0504).
 * Read-only, under the caller's RLS (grant_applications is member-readable).
 */

import type { PoolClient } from "@neondatabase/serverless";

export type GrantOption = {
  id: string;
  name: string;
  funder: string | null;
  seasonYear: number;
  status: string;
};

export function grantOptionLabel(option: Pick<GrantOption, "name" | "funder" | "seasonYear" | "status">): string {
  const funder = option.funder ? ` · ${option.funder}` : "";
  const status = option.status === "awarded" ? "" : ` (${option.status.replace(/_/g, " ")})`;
  return `${option.name}${funder} · ${option.seasonYear}${status}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function grantIdOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value.trim()) ? value.trim() : null;
}

/** Declined grants never paid for anything; everything else can be tagged. Awarded first. */
export async function loadGrantOptions(client: PoolClient, orgId: string): Promise<GrantOption[]> {
  const result = await client.query<GrantOption>(
    `SELECT ga.id, COALESCE(go.name, 'Grant') AS name, go.funder,
            ga.season_year AS "seasonYear", ga.status::text AS status
     FROM grant_applications ga
     LEFT JOIN grant_opportunities go ON go.id = ga.grant_opportunity_id
     WHERE ga.org_id = $1::uuid AND ga.status <> 'declined'
     ORDER BY (ga.status = 'awarded') DESC, ga.season_year DESC, name
     LIMIT 200`,
    [orgId],
  );
  return result.rows.map((row) => ({ ...row, seasonYear: Number(row.seasonYear) }));
}

/** Throws unless the grant belongs to this org — an expense can only be tagged to the team's own grant. */
export async function assertGrantInOrg(client: PoolClient, orgId: string, grantApplicationId: string): Promise<void> {
  const row = await client.query(`SELECT 1 FROM grant_applications WHERE id = $1::uuid AND org_id = $2::uuid`, [
    grantApplicationId,
    orgId,
  ]);
  if (!row.rowCount) throw new Error("Grant application not found in this workspace");
}
