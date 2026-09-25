/**
 * The team's own records, beside the event data: roster, hours, calendar, tasks, money,
 * sponsors, robot failures and batteries. One table each, laid out like the rest of the
 * workbook (lib/microsoft/workbook-schema): `id` first (the Postgres key), readable
 * snake_case columns, ISO-8601 UTC times, `updated_at` and `source` last.
 *
 * Every table is read in its own savepoint on the caller's withRls client, so a table this
 * deployment has not migrated yet (or one the caller may not read) is an empty table, never
 * a failed sync. Only what the caller could already see in Vantage comes back.
 *
 * Kept out: email addresses, dates of birth and anything else a teammate's profile holds
 * privately. A member is a name and a team role.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import {
  MAX_ROWS_PER_TABLE,
  buildSyncInfoTable,
  buildWorkbookTables,
  toCell,
  type BuiltTable,
  type CellValue,
  type TableSpec,
  type WorkbookSource,
} from "./workbook-schema";

export type OpsEntity =
  | "Members"
  | "Hours"
  | "Calendar"
  | "Tasks"
  | "Finance"
  | "Sponsors"
  | "RobotFailures"
  | "Batteries";

type OpsTableDef = {
  entity: OpsEntity;
  /** What the table holds, in one line. Also printed in the Tables catalog. */
  description: string;
  columns: string[];
  /** Parameterised by the team id only; must return exactly `columns`, in order. */
  sql: string;
};

const ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

const ROLE_LABEL = `CASE m.role::text WHEN 'owner' THEN 'Owner' WHEN 'admin' THEN 'Mentor or coach'
                   WHEN 'scout' THEN 'Student' WHEN 'viewer' THEN 'Parent or guest' ELSE m.role::text END`;

export const OPS_TABLES: OpsTableDef[] = [
  {
    entity: "Members",
    description: "Everyone on the team: name, team role and when they joined.",
    columns: ["id", "name", "role", "role_label", "joined_at", "updated_at", "source"],
    sql: `SELECT m.user_id::text AS id, COALESCE(NULLIF(u.name, ''), 'Member') AS name, m.role::text AS role,
                 ${ROLE_LABEL} AS role_label, ${ISO("m.created_at")} AS joined_at, ${ISO("m.created_at")} AS updated_at,
                 'membership' AS source
            FROM memberships m
            JOIN users u ON u.id = m.user_id
           WHERE m.org_id = $1::uuid
           ORDER BY m.created_at, m.user_id`,
  },
  {
    entity: "Hours",
    description: "Every clock-in: who, what kind of time, when, and how many hours.",
    columns: ["id", "member_id", "member", "kind", "clock_in", "clock_out", "hours", "note", "updated_at", "source"],
    sql: `SELECT h.id::text AS id, h.user_id::text AS member_id, COALESCE(NULLIF(u.name, ''), 'Member') AS member,
                 h.kind, ${ISO("h.clock_in")} AS clock_in, ${ISO("h.clock_out")} AS clock_out,
                 CASE WHEN h.clock_out IS NULL THEN NULL
                      ELSE round((extract(epoch FROM (h.clock_out - h.clock_in)) / 3600)::numeric, 2)::float8 END AS hours,
                 h.note, ${ISO("COALESCE(h.clock_out, h.created_at)")} AS updated_at,
                 CASE WHEN h.closed_by IS NOT NULL AND h.closed_by <> h.user_id THEN 'closed_by_mentor' ELSE 'self' END AS source
            FROM hour_logs h
            LEFT JOIN users u ON u.id = h.user_id
           WHERE h.org_id = $1::uuid
           ORDER BY h.clock_in, h.id`,
  },
  {
    entity: "Calendar",
    description: "Practices, meetings, deadlines and events on the team calendar.",
    columns: ["id", "title", "kind", "starts_at", "ends_at", "location", "subteam", "notes", "updated_at", "source"],
    sql: `SELECT e.id::text AS id, e.title, e.kind, ${ISO("e.starts_at")} AS starts_at, ${ISO("e.ends_at")} AS ends_at,
                 e.location, COALESCE(s.name, 'Whole team') AS subteam, e.notes, ${ISO("e.updated_at")} AS updated_at,
                 'team_calendar' AS source
            FROM subteam_calendar_events e
            LEFT JOIN team_subteams s ON s.id = e.subteam_id
           WHERE e.org_id = $1::uuid
           ORDER BY e.starts_at, e.id`,
  },
  {
    entity: "Tasks",
    description: "Team to-dos: status, who has it, due date.",
    columns: ["id", "title", "status", "assignee", "subteam", "due_on", "completed_at", "notes", "created_at", "updated_at", "source"],
    sql: `SELECT t.id::text AS id, t.title, t.status, u.name AS assignee, s.name AS subteam,
                 to_char(t.due_on, 'YYYY-MM-DD') AS due_on, ${ISO("t.completed_at")} AS completed_at, t.notes,
                 ${ISO("t.created_at")} AS created_at, ${ISO("t.updated_at")} AS updated_at, 'team_todos' AS source
            FROM team_todos t
            LEFT JOIN users u ON u.id = t.assignee_user_id
            LEFT JOIN team_subteams s ON s.id = t.subteam_id
           WHERE t.org_id = $1::uuid
           ORDER BY t.created_at, t.id`,
  },
  {
    entity: "Finance",
    description: "Money in and out: every recorded income and expense, by season and category.",
    columns: ["id", "season_year", "type", "amount_usd", "occurred_at", "category", "description", "created_at", "updated_at", "source"],
    sql: `SELECT f.id::text AS id, f.season_year, f.type::text AS type, f.amount_usd::float8 AS amount_usd,
                 ${ISO("f.occurred_at")} AS occurred_at, c.name AS category, f.description,
                 ${ISO("f.created_at")} AS created_at, ${ISO("f.created_at")} AS updated_at, f.source::text AS source
            FROM finance_transactions f
            LEFT JOIN finance_categories c ON c.id = f.category_id
           WHERE f.org_id = $1::uuid
           ORDER BY f.occurred_at, f.id`,
  },
  {
    entity: "Sponsors",
    description: "Sponsors and prospects: tier, status and where they are.",
    columns: [
      "id", "name", "tier", "status", "industry", "website", "city", "state_prov",
      "first_sponsored_season", "notes", "created_at", "updated_at", "source",
    ],
    sql: `SELECT s.id::text AS id, s.name, s.tier::text AS tier, s.status::text AS status, s.industry, s.website,
                 s.city, s.state_prov, s.first_sponsored_season, s.notes,
                 ${ISO("s.created_at")} AS created_at, ${ISO("s.updated_at")} AS updated_at, 'sponsors' AS source
            FROM sponsors s
           WHERE s.org_id = $1::uuid
           ORDER BY s.name, s.id`,
  },
  {
    entity: "RobotFailures",
    description: "Every logged robot failure: subsystem, how bad, what fixed it.",
    columns: [
      "id", "event_key", "match_key", "robot", "subsystem", "severity", "symptoms", "cause", "resolution",
      "downtime_seconds", "occurred_at", "updated_at", "source",
    ],
    sql: `SELECT f.id::text AS id, f.event_key, f.match_key, f.robot_label AS robot, f.subsystem, f.severity,
                 f.symptoms, f.cause, f.resolution, f.downtime_seconds, ${ISO("f.occurred_at")} AS occurred_at,
                 ${ISO("f.created_at")} AS updated_at, 'failure_log' AS source
            FROM robot_failures f
           WHERE f.org_id = $1::uuid
           ORDER BY f.occurred_at, f.id`,
  },
  {
    entity: "Batteries",
    description: "The team's batteries: label, status, brand, size and what each is for.",
    columns: ["id", "label", "status", "brand", "nominal_ah", "purchase_date", "assignment", "notes", "updated_at", "source"],
    sql: `SELECT b.id::text AS id, b.label, b.status, b.brand, b.nominal_ah::float8 AS nominal_ah,
                 to_char(b.purchase_date, 'YYYY-MM-DD') AS purchase_date, b.assignment, b.notes,
                 ${ISO("b.updated_at")} AS updated_at, 'battery_packs' AS source
            FROM battery_packs b
           WHERE b.org_id = $1::uuid
           ORDER BY b.label, b.id`,
  },
];

export type OpsRows = Partial<Record<OpsEntity, Record<string, unknown>[]>>;

/** Read every team table. A table that cannot be read (not migrated, not allowed) comes back empty. */
export async function loadOpsTables(client: PoolClient, orgId: string): Promise<OpsRows> {
  const out: OpsRows = {};
  for (const table of OPS_TABLES) {
    out[table.entity] = await withSavepoint(
      client,
      async () =>
        (await client.query<Record<string, unknown>>(`${table.sql} LIMIT ${MAX_ROWS_PER_TABLE + 1}`, [orgId])).rows,
      [] as Record<string, unknown>[],
    );
  }
  return out;
}

function opsSpec(table: OpsTableDef): TableSpec {
  return { entity: table.entity, sheet: table.entity, table: `Vantage${table.entity}`, columns: table.columns };
}

/** The team tables, in catalog order. Rows keep the query's order, capped like every table. */
export function buildOpsTables(rows: OpsRows | undefined): BuiltTable[] {
  return OPS_TABLES.map((table) => {
    const source = (rows?.[table.entity] ?? []).slice(0, MAX_ROWS_PER_TABLE);
    const built: CellValue[][] = source.map((row) => table.columns.map((column) => toCell(row[column])));
    return { spec: opsSpec(table), rows: built };
  });
}

export function opsTableDescription(entity: string): string | null {
  return OPS_TABLES.find((table) => table.entity === entity)?.description ?? null;
}

// ------------------------------------------------------------------ the whole workbook

const CORE_DESCRIPTIONS: Record<string, string> = {
  Teams: "Teams at the active event, with ratings and record.",
  Matches: "The active event's match schedule and results.",
  MatchScouting: "Every match scouting entry, one row per robot per match.",
  PitScouting: "Every pit scouting entry, one row per robot.",
  PickList: "The team's pick lists, one row per ranked team.",
  SyncInfo: "When this copy was last updated, and a check value for comparing copies.",
};

export const CATALOG_COLUMNS = ["id", "description", "primary_key", "rows", "columns", "updated_at", "source"];

/** One row per table: what it holds, its key, how many rows, and its columns. */
export function buildCatalogTable(tables: BuiltTable[], now: Date): BuiltTable {
  const at = now.toISOString();
  const rows = tables.map((table) =>
    [
      table.spec.sheet,
      opsTableDescription(table.spec.entity) ?? CORE_DESCRIPTIONS[table.spec.entity] ?? "",
      "id",
      table.rows.length,
      table.spec.columns.join(", "),
      at,
      "vantage",
    ].map(toCell),
  );
  return { spec: { entity: "Tables", sheet: "Tables", table: "VantageTables", columns: CATALOG_COLUMNS }, rows };
}

/**
 * Every table a team's copy holds, in tab order: the event and scouting tables, the team's own
 * records, the Tables catalog, then SyncInfo. Deterministic for a given source and clock.
 */
export function buildAllTables(source: WorkbookSource, now: Date): BuiltTable[] {
  const core = buildWorkbookTables(source, now).filter((table) => table.spec.entity !== "SyncInfo");
  const data = [...core, ...buildOpsTables(source.ops as OpsRows | undefined)];
  return [...data, buildCatalogTable(data, now), buildSyncInfoTable(source, data, now)];
}
