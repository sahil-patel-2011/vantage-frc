#!/usr/bin/env node
// Schema metadata only: no user rows, credentials or connection strings enter the artifact.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";

const connection = process.env.RELEASE_INVENTORY_DATABASE_URL;
if (!connection) throw new Error("Set RELEASE_INVENTORY_DATABASE_URL explicitly for the database being inventoried.");
const client = new pg.Client({ connectionString: connection });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tables = (await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,c.relispartition AS partition,
    c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'nullable',NOT a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb) AS columns,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname)
      FROM pg_constraint k WHERE k.conrelid=c.oid),'[]'::jsonb) AS constraints,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.policyname,'roles',p.roles,'command',p.cmd,'using',p.qual,'check',p.with_check) ORDER BY p.policyname)
      FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname),'[]'::jsonb) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
    ORDER BY n.nspname,c.relname`)).rows;
  const sequences = (await client.query("SELECT schemaname AS schema,sequencename AS name,data_type,start_value,min_value,max_value,increment_by,cycle FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,sequencename")).rows;
  const roles = (await client.query("SELECT rolname AS name,rolsuper AS superuser,rolbypassrls AS bypass_rls,rolcanlogin AS login FROM pg_roles WHERE rolname LIKE 'vantage_%' ORDER BY rolname")).rows;
  const hasCoverage = (await client.query("SELECT to_regclass('public.recovery_coverage') IS NOT NULL AS present")).rows[0].present;
  const coverage = hasCoverage ? (await client.query("SELECT schema_name,table_name,rows_covered,truncation_covered FROM recovery_coverage ORDER BY schema_name,table_name")).rows : [];
  await client.query("COMMIT");
  const artifact = { schemaVersion: 1, observedAt: new Date().toISOString(), environment: process.argv.includes("--production") ? "production read-only inspection" : "scratch database", summary: { tables: tables.length, partitions: tables.filter((table) => table.partition).length, sequences: sequences.length, roles: roles.length, recoveryCoverageInstalled: hasCoverage, capturedTables: coverage.length, uncoveredTables: hasCoverage ? coverage.filter((row) => !row.rows_covered || !row.truncation_covered).length : null }, tables, sequences, roles, coverage };
  const directory = fileURLToPath(new URL("../docs/release/", import.meta.url));
  await mkdir(directory, { recursive: true });
  const filename = process.argv.includes("--production") ? "database-inventory-production.json" : "database-inventory-scratch.json";
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("--output requires a path.");
  const output = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : `${directory}/${filename}`;
  await writeFile(output, JSON.stringify(artifact, null, 2) + "\n");
  console.log(JSON.stringify({ environment: artifact.environment, ...artifact.summary }));
} finally { await client.query("ROLLBACK"); await client.end(); }
