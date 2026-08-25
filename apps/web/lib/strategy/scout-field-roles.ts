import type { PoolClient } from "@neondatabase/serverless";
import {
  fieldRolesFromSchemaDefinitions,
  type ScoutFieldRoleMap,
} from "@vantage/prediction-strategy";

/**
 * Load the org's published scout schemas (latest match + pit for the event's
 * season, falling back to the newest published season) and turn them into the
 * payload-key → strategy-role map the scout→strategy bridge resolves first.
 *
 * Custom form-builder fields carry an explicit `config.role`; older schemas
 * without one fall back to key inference inside fieldRolesFromSchemaDefinitions,
 * so data collected with ANY published schema reaches strategy.
 *
 * Degrades to an empty map (legacy key-convention behavior) if the lookup
 * fails — strategy must never hard-fail because role metadata is unavailable.
 */
export async function loadScoutFieldRoles(
  client: PoolClient,
  orgId: string,
  eventKey: string | null,
): Promise<ScoutFieldRoleMap> {
  try {
    const result = await client.query<{ schema: unknown }>(
      `SELECT DISTINCT ON (type) schema
         FROM scout_schemas
        WHERE org_id = $1::uuid
        ORDER BY type,
          (year = (SELECT year FROM events_ref WHERE event_key = $2::text)) DESC NULLS LAST,
          year DESC, version DESC`,
      [orgId, eventKey],
    );
    return fieldRolesFromSchemaDefinitions(
      result.rows.map(
        (row) => row.schema as Parameters<typeof fieldRolesFromSchemaDefinitions>[0][number],
      ),
    );
  } catch {
    return {};
  }
}
