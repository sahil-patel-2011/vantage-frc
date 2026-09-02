import type { PoolClient } from "@neondatabase/serverless";
import {
  fieldRolesFromSchemaDefinitions,
  normalizeSignalKey,
  type ScoutFieldRoleMap,
} from "@vantage/prediction-strategy";

/** One published form field, as the strategy bridge sees it. */
export type ScoutFieldCatalogEntry = {
  key: string;
  type: string | null;
  config: Record<string, unknown> | null;
};

export type ScoutFieldCatalog = {
  /** payload-key → strategy role (explicit `config.role` wins, else key inference). */
  roles: ScoutFieldRoleMap;
  /** Every field on the latest match + pit schema, roles or not. */
  fields: ScoutFieldCatalogEntry[];
};

type LooseSchema = {
  fields?: Array<{ key?: unknown; type?: unknown; config?: unknown } | null> | null;
} | null;

function catalogFromSchemas(schemas: LooseSchema[]): ScoutFieldCatalogEntry[] {
  const seen = new Set<string>();
  const fields: ScoutFieldCatalogEntry[] = [];
  for (const schema of schemas) {
    for (const field of schema?.fields ?? []) {
      if (!field || typeof field.key !== "string" || !field.key || seen.has(field.key)) continue;
      seen.add(field.key);
      fields.push({
        key: field.key,
        type: typeof field.type === "string" ? field.type : null,
        config:
          field.config && typeof field.config === "object" && !Array.isArray(field.config)
            ? (field.config as Record<string, unknown>)
            : null,
      });
    }
  }
  return fields;
}

/** Legacy convention keys the pit/match forms used before the builder existed. */
export const LEGACY_CYCLE_TIME_KEYS = [
  "cycleTime",
  "cycle_time",
  "avgCycleTime",
  "secondsPerCycle",
  "cycleSeconds",
  "teleopCycleTime",
] as const;

/**
 * Payload keys that carry a cycle time, resolved from the org's PUBLISHED form fields
 * rather than a hard-coded list: any field whose key names a cycle (cycle_time,
 * "Avg cycle (s)", teleop_cycle_seconds…) counts, and a timer field named "cycle"
 * counts too. Legacy convention keys stay as a fallback so old payloads still resolve.
 * Pure — unit-tested.
 */
export function cycleTimeFieldKeys(fields: readonly ScoutFieldCatalogEntry[]): string[] {
  const keys: string[] = [];
  for (const field of fields) {
    const norm = normalizeSignalKey(field.key);
    if (!norm.includes("cycle")) continue;
    // "cycles" / "teleopCycles" are counts, not durations — only accept duration-ish names.
    const durationish =
      /time|sec|second|duration|avg|average|speed/.test(norm) || field.type === "timer";
    if (!durationish) continue;
    keys.push(field.key);
  }
  for (const legacy of LEGACY_CYCLE_TIME_KEYS) if (!keys.includes(legacy)) keys.push(legacy);
  return keys;
}

/**
 * Load the org's published scout schemas (latest match + pit for the event's
 * season, falling back to the newest published season) as a field catalog: the
 * payload-key → strategy-role map the scout→strategy bridge resolves first, plus
 * the raw field list for signals that have no role (cycle time).
 *
 * Custom form-builder fields carry an explicit `config.role`; older schemas
 * without one fall back to key inference inside fieldRolesFromSchemaDefinitions,
 * so data collected with ANY published schema reaches strategy.
 *
 * Degrades to an empty catalog (legacy key-convention behavior) if the lookup
 * fails — strategy must never hard-fail because role metadata is unavailable.
 */
export async function loadScoutFieldCatalog(
  client: PoolClient,
  orgId: string,
  eventKey: string | null,
): Promise<ScoutFieldCatalog> {
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
    const schemas = result.rows.map((row) => row.schema as LooseSchema);
    return {
      roles: fieldRolesFromSchemaDefinitions(
        schemas as Parameters<typeof fieldRolesFromSchemaDefinitions>[0],
      ),
      fields: catalogFromSchemas(schemas),
    };
  } catch {
    return { roles: {}, fields: [] };
  }
}

/** Role map only — the shape most strategy callers already consume. */
export async function loadScoutFieldRoles(
  client: PoolClient,
  orgId: string,
  eventKey: string | null,
): Promise<ScoutFieldRoleMap> {
  return (await loadScoutFieldCatalog(client, orgId, eventKey)).roles;
}
