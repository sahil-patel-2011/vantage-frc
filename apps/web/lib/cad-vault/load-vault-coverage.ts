import type { PoolClient } from "@neondatabase/serverless";

/**
 * Org-scoped counts of non-archived cad_documents linked to robot_subsystems.
 * Returns an empty map when the vault table is not installed — never fabricates rows.
 */
export async function loadVaultDocumentCounts(
  client: PoolClient,
  orgId: string,
  subsystemIds?: readonly string[],
): Promise<Map<string, number>> {
  const installed = await client.query<{ ok: string | null }>(
    `SELECT to_regclass('public.cad_documents')::text AS ok`,
  );
  if (!installed.rows[0]?.ok) return new Map();

  const ids = [...new Set((subsystemIds ?? []).filter(Boolean))];
  const result = await client.query<{ subsystemId: string; documentCount: number }>(
    `SELECT d.subsystem_id AS "subsystemId", count(*)::int AS "documentCount"
     FROM cad_documents d
     WHERE d.org_id = $1::uuid
       AND d.subsystem_id IS NOT NULL
       AND d.status <> 'archived'
       AND ($2::uuid[] IS NULL OR d.subsystem_id = ANY($2::uuid[]))
     GROUP BY d.subsystem_id`,
    [orgId, ids.length ? ids : null],
  );
  return new Map(result.rows.map((row) => [row.subsystemId, Number(row.documentCount)]));
}
