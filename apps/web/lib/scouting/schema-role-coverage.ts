// Does the org's PUBLISHED form actually reach strategy?
//
// The scout-to-strategy bridge resolves a payload key to a strategy signal in this order (see
// packages/prediction-strategy/src/scout-ops.ts):
//   1. the field's explicit `config.role`,
//   2. the legacy camelCase convention keys,
//   3. a case/underscore-insensitive normalization of those same names.
// That ladder is deliberately forgiving, which is exactly why a custom form can collect a
// season's worth of match data and still hand strategy `null` auto/teleop/endgame capabilities
// without anyone noticing: nothing ever says "no published field maps to teleop_score".
//
// This module is that missing warning. It is NOT a third mapping model — it reads the SAME
// `config.role` metadata through the SAME fieldRolesFromSchemaDefinitions /
// inferRoleForFieldKey helpers strategy uses, and only reports what those resolve to.

import type { PoolClient } from "@neondatabase/serverless";
import {
  fieldRolesFromSchemaDefinitions,
  inferRoleForFieldKey,
  isStrategyFieldRole,
  type ScoutFieldRoleMap,
  type StrategyFieldRole,
} from "@vantage/prediction-strategy";

export type ScoutSchemaKind = "match" | "pit";

export type AuditableSchema = {
  type: ScoutSchemaKind;
  /** The stored jsonb, however it survived the round-trip. */
  definition: unknown;
};

export type ScoutRoleWarningSeverity = "blocking" | "warning";

export type ScoutRoleWarning = {
  id: string;
  severity: ScoutRoleWarningSeverity;
  role: StrategyFieldRole | null;
  message: string;
  /** Payload keys the warning is about, when it names specific fields. */
  fields: string[];
};

export type ScoutRoleCoverage = {
  /** no_schema = nothing published yet (an honest setup state, not a warning). */
  status: "no_schema" | "ok" | "warnings";
  /** Exactly what strategy will resolve: payload key to role. */
  roles: ScoutFieldRoleMap;
  mappedRoles: StrategyFieldRole[];
  missingRoles: StrategyFieldRole[];
  /** Answerable fields no role resolves for — collected but invisible to strategy. */
  unmappedFields: Array<{ key: string; label: string; schema: ScoutSchemaKind }>;
  /** Fields whose builder explicitly opted out with `config.role = "none"`. */
  optedOutFields: Array<{ key: string; label: string; schema: ScoutSchemaKind }>;
  warnings: ScoutRoleWarning[];
};

/**
 * Signals strategy cannot substitute for. Without a field resolving to these, pick capabilities
 * and blended EPA silently stay null, so a missing mapping is blocking rather than advisory.
 */
const BLOCKING_ROLES: StrategyFieldRole[] = ["auto_score", "teleop_score", "endgame"];

/** Signals that degrade a callout when absent but never zero out a pick score. */
const ADVISORY_ROLES: StrategyFieldRole[] = ["fouls", "defense", "notes"];

const ROLE_LABELS: Record<StrategyFieldRole, string> = {
  none: "opted out",
  auto_score: "auto scoring",
  teleop_score: "teleop scoring",
  endgame: "endgame / climb",
  defense: "defense played",
  fouls: "fouls / penalties",
  notes: "free-text notes",
};

/** Layout-only field types carry no answer, so they can never map to a strategy signal. */
const LAYOUT_ONLY_TYPES = new Set(["section_header", "section"]);

type LooseField = {
  key?: unknown;
  label?: unknown;
  type?: unknown;
  config?: unknown;
};

function fieldsOf(definition: unknown): LooseField[] {
  if (!definition || typeof definition !== "object") return [];
  const fields = (definition as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (field): field is LooseField => Boolean(field) && typeof field === "object",
  );
}

function configuredRole(field: LooseField): StrategyFieldRole | null {
  const role = (field.config as { role?: unknown } | null | undefined)?.role;
  return isStrategyFieldRole(role) ? role : null;
}

/**
 * Audit published schemas against the roles strategy will actually resolve.
 * Pure — no DB, no clock — so the warning copy is unit-testable.
 */
export function auditScoutSchemaRoles(schemas: AuditableSchema[]): ScoutRoleCoverage {
  const usable = schemas.filter((schema) => fieldsOf(schema.definition).length > 0);
  if (!usable.length) {
    return {
      status: "no_schema",
      roles: {},
      mappedRoles: [],
      missingRoles: [],
      unmappedFields: [],
      optedOutFields: [],
      warnings: [],
    };
  }

  // Match schema first so its roles win key collisions, exactly like the loader does.
  const ordered = [...usable].sort(
    (a, b) => (a.type === "match" ? 0 : 1) - (b.type === "match" ? 0 : 1),
  );
  const roles = fieldRolesFromSchemaDefinitions(
    ordered.map(
      (schema) =>
        schema.definition as Parameters<typeof fieldRolesFromSchemaDefinitions>[0][number],
    ),
  );

  const mapped = new Set<StrategyFieldRole>();
  for (const role of Object.values(roles)) {
    if (role !== "none") mapped.add(role);
  }

  const unmappedFields: ScoutRoleCoverage["unmappedFields"] = [];
  const optedOutFields: ScoutRoleCoverage["optedOutFields"] = [];
  const seenKeys = new Set<string>();
  for (const schema of ordered) {
    for (const field of fieldsOf(schema.definition)) {
      if (typeof field.key !== "string" || !field.key) continue;
      if (typeof field.type === "string" && LAYOUT_ONLY_TYPES.has(field.type)) continue;
      if (seenKeys.has(field.key)) continue;
      seenKeys.add(field.key);
      const label =
        typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.key;
      if (configuredRole(field) === "none") {
        optedOutFields.push({ key: field.key, label, schema: schema.type });
        continue;
      }
      const resolved = roles[field.key] ?? inferRoleForFieldKey(field.key);
      if (resolved === "none") unmappedFields.push({ key: field.key, label, schema: schema.type });
    }
  }

  // Auto/teleop/endgame/foul/defense signals only come off the match form; notes come off either.
  const hasMatchSchema = ordered.some((schema) => schema.type === "match");
  const relevant = (role: StrategyFieldRole) => (role === "notes" ? true : hasMatchSchema);

  const missingRoles = [...BLOCKING_ROLES, ...ADVISORY_ROLES].filter(
    (role) => relevant(role) && !mapped.has(role),
  );

  const warnings: ScoutRoleWarning[] = [];
  for (const role of missingRoles) {
    const blocking = BLOCKING_ROLES.includes(role);
    warnings.push({
      id: `missing-role:${role}`,
      severity: blocking ? "blocking" : "warning",
      role,
      message: blocking
        ? `No published question maps to ${ROLE_LABELS[role]}. Strategy and the pick desk read null for it no matter how much you scout — set that question's role to "${role}" in Form builder.`
        : `No published question maps to ${ROLE_LABELS[role]}, so that callout stays blank instead of wrong.`,
      fields: [],
    });
  }

  if (unmappedFields.length) {
    const named = unmappedFields
      .slice(0, 6)
      .map((field) => field.label)
      .join(", ");
    warnings.push({
      id: "unmapped-fields",
      severity: "warning",
      role: null,
      message: `${unmappedFields.length} published question${
        unmappedFields.length === 1 ? "" : "s"
      } reach no strategy signal (${named}). Scouts fill them and strategy never sees the answer — give each one a role in Form builder, or accept that it is reference-only.`,
      fields: unmappedFields.map((field) => field.key),
    });
  }

  const optedOutBlocking = optedOutFields.filter((field) =>
    BLOCKING_ROLES.includes(inferRoleForFieldKey(field.key)),
  );
  if (optedOutBlocking.length) {
    warnings.push({
      id: "opted-out-blocking",
      severity: "warning",
      role: null,
      message: `${optedOutBlocking
        .map((field) => field.label)
        .join(
          ", ",
        )} look like scoring questions but are explicitly opted out (role "none"), so strategy ignores them.`,
      fields: optedOutBlocking.map((field) => field.key),
    });
  }

  return {
    status: warnings.length ? "warnings" : "ok",
    roles,
    mappedRoles: [...mapped].sort(),
    missingRoles,
    unmappedFields,
    optedOutFields,
    warnings,
  };
}

/** True when strategy will read a null for a signal no published question supplies. */
export function hasBlockingRoleGap(coverage: ScoutRoleCoverage): boolean {
  return coverage.warnings.some((warning) => warning.severity === "blocking");
}

/**
 * Load the org's latest published match + pit schemas and audit them.
 *
 * Mirrors loadScoutFieldRoles' selection (latest per type, preferring the event's season) so the
 * audit reports on exactly the schemas strategy resolves against. Degrades to `no_schema` on any
 * lookup failure — a warning panel must never take a page down.
 */
export async function loadScoutRoleCoverage(
  client: PoolClient,
  orgId: string,
  eventKey: string | null,
): Promise<ScoutRoleCoverage> {
  try {
    const result = await client.query<{ type: ScoutSchemaKind; schema: unknown }>(
      `SELECT DISTINCT ON (type) type::text AS type, schema
         FROM scout_schemas
        WHERE org_id = $1::uuid
        ORDER BY type,
          (year = (SELECT year FROM events_ref WHERE event_key = $2::text)) DESC NULLS LAST,
          year DESC, version DESC`,
      [orgId, eventKey],
    );
    return auditScoutSchemaRoles(
      result.rows.map((row) => ({ type: row.type, definition: row.schema })),
    );
  } catch {
    return auditScoutSchemaRoles([]);
  }
}
