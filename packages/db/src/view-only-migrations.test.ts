/**
 * View only = read-only (0715), checked from the migration files alone so it runs
 * in every `npm test`, with or without a database.
 *
 * The rule a future migration must follow: a file that creates an org-scoped table
 * ends with `SELECT install_view_only_guards();` (after exempting the table in
 * view_only_exempt_tables if it holds a person's own state). The database-level
 * twin of this check is view-only-integration.test.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VIEW_ONLY_MESSAGE } from "./view-only";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const VIEW_ONLY_MIGRATION = "0715_view_only_read_only.sql";

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function read(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

/** Tables a migration creates with an org_id column (balanced-paren body scan). */
function orgScopedTablesCreatedIn(sql: string): string[] {
  const tables: string[] = [];
  const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = create.exec(sql))) {
    let depth = 1;
    let index = create.lastIndex;
    for (; index < sql.length && depth > 0; index += 1) {
      if (sql[index] === "(") depth += 1;
      else if (sql[index] === ")") depth -= 1;
    }
    const body = sql.slice(create.lastIndex, index);
    if (/(^|[\s,(])org_id\s/i.test(body)) tables.push(match[1]!.toLowerCase());
  }
  return tables;
}

/** The `(table_name, reason, added_in)` rows 0715 seeds into view_only_exempt_tables. */
function exemptRows(sql: string): Array<{ table: string; reason: string }> {
  const start = sql.indexOf("INSERT INTO view_only_exempt_tables");
  const end = sql.indexOf("ON CONFLICT (table_name)", start);
  const block = sql.slice(start, end);
  const rows: Array<{ table: string; reason: string }> = [];
  const row = /\(\s*'([a-z_0-9]+)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'0715'\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = row.exec(block))) rows.push({ table: match[1]!, reason: match[2]!.replace(/''/g, "'") });
  return rows;
}

describe("View only migrations (0715)", () => {
  const sql = read(VIEW_ONLY_MIGRATION);

  it("parses org-scoped CREATE TABLEs the way the policies see them", () => {
    expect(orgScopedTablesCreatedIn(read("0024_competition_operations.sql")).length).toBeGreaterThan(0);
    expect(orgScopedTablesCreatedIn("CREATE TABLE t (id uuid, org_id uuid NOT NULL REFERENCES organizations(id));")).toEqual(["t"]);
    expect(orgScopedTablesCreatedIn("CREATE TABLE IF NOT EXISTS u (id uuid, user_id uuid, CHECK (length(x) > 0));")).toEqual([]);
  });

  it("defines the predicate, the refusal, the installer and the coverage view", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION is_org_viewer\(target_org_id uuid\) RETURNS boolean\s+LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION is_org_viewer\(uuid\) TO vantage_app, vantage_worker/);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION refuse_view_only_write(target_org_id uuid)");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION install_view_only_guards()");
    expect(sql).toContain("SELECT install_view_only_guards();");
    expect(sql).toContain("CREATE OR REPLACE VIEW view_only_guard_coverage");
    // Request role only: jobs (vantage_worker) and service roles keep working.
    for (const name of ["view_only_no_insert", "view_only_no_update", "view_only_no_delete"]) {
      expect(sql).toMatch(new RegExp(`CREATE POLICY ${name} ON public\\.%I AS RESTRICTIVE FOR (INSERT|UPDATE|DELETE) TO vantage_app`));
    }
  });

  it("raises exactly the sentence the API answers with", () => {
    expect(sql).toContain(`RAISE EXCEPTION '${VIEW_ONLY_MESSAGE}'`);
    expect(sql).toContain("ERRCODE = 'insufficient_privilege', DETAIL = 'vantage:view_only'");
  });

  it("gives every exempt table a reason, once", () => {
    const rows = exemptRows(sql);
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(new Set(rows.map((row) => row.table)).size).toBe(rows.length);
    for (const row of rows) expect(row.reason.trim().length, row.table).toBeGreaterThanOrEqual(12);
    const exempt = new Set(rows.map((row) => row.table));
    // Personal state stays writable…
    for (const table of ["notifications", "push_subscriptions", "dashboards", "announcement_acks", "org_message_reports"]) {
      expect(exempt.has(table), table).toBe(true);
    }
    // …team data never is: posting chat, scouting, tasks, calendar, inventory, CAD.
    for (const table of [
      "org_messages",
      "org_conversations",
      "match_scout_entries",
      "pit_scout_entries",
      "build_tasks",
      "team_todos",
      "subteam_calendar_events",
      "subteam_calendar_rsvps",
      "inventory_items",
      "cad_documents",
      "memberships",
    ]) {
      expect(exempt.has(table), table).toBe(false);
    }
  });

  it("makes every later migration that creates an org-scoped table install the guards", () => {
    const later = migrationFiles().filter((name) => name > VIEW_ONLY_MIGRATION);
    const offenders = later.filter(
      (name) => orgScopedTablesCreatedIn(read(name)).length > 0 && !/install_view_only_guards\s*\(\s*\)/.test(read(name)),
    );
    expect(
      offenders,
      "End the migration with SELECT install_view_only_guards(); (exempt personal tables in view_only_exempt_tables first)",
    ).toEqual([]);
  });
});
