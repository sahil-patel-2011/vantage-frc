/**
 * Positive and negative fixtures for the tenancy checks, plus a scan of the
 * tree that fails when a new violation shows up or an allowlist row goes stale.
 *
 * ESLint enforces the import ban while `npm run lint` runs. These fixtures
 * prove that rule fires, and the scanners below catch the cases a glob cannot:
 * dynamic import(), SQL templates, migration bytes, and requestPool.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import {
  requestPoolAllowlist,
  signedInAdminImportAllowlist,
  sqlFragmentAllowlist,
  workerImportAllowlist,
} from "./security-boundary-allowlist.mjs";
import {
  concatenatedSql,
  forbiddenImports,
  interpolatedSqlTemplates,
  lowercaseSqlTemplates,
  migrationDrift,
  productSourceFiles,
  readRepoFile,
  REPO_ROOT,
  requestPoolCalls,
  signedInAdminImportHits,
  supabaseKeyReads,
  unexpectedForbiddenImports,
  unsafeSqlTemplates,
  withRlsRoleGaps,
} from "./security-boundaries.mjs";

type AllowFile = { file: string; reason: string };

const CRON_FIXTURE = "apps/web/app/api/cron/example/route.ts";
const ROUTE_FIXTURE = "apps/web/app/api/widgets/route.ts";

function filesOf(entries: readonly AllowFile[]): string[] {
  return entries.map((entry) => entry.file);
}

describe("worker and Supabase imports", () => {
  it("flags static, dynamic, require, and re-export of banned modules", () => {
    const source = [
      'import { dbAdmin } from "@vantage/db/admin";',
      'await import("@vantage/reference/production-worker");',
      'const client = require("@supabase/supabase-js");',
      'export { syncNexusEvents } from "@vantage/reference/nexus-ingest";',
    ].join("\n");
    expect(forbiddenImports(source).map((hit) => hit.specifier).sort()).toEqual([
      "@supabase/supabase-js",
      "@vantage/db/admin",
      "@vantage/reference/nexus-ingest",
      "@vantage/reference/production-worker",
    ]);
  });

  it("does not flag withRls, comments, or a sentence that names the module", () => {
    const source = [
      'import { withRls } from "@vantage/db";',
      'const note = "do not import @vantage/db/admin";',
      '// import { dbAdmin } from "@vantage/db/admin"',
      "export async function GET() { return withRls({ userId: \"u\" }, async () => 1); }",
    ].join("\n");
    expect(forbiddenImports(source)).toEqual([]);
  });

  it("permits a specifier only on the file that names it", () => {
    const source = 'import { dbAdmin } from "@vantage/db/admin";\n';
    const allow = [
      {
        file: CRON_FIXTURE,
        specifiers: ["@vantage/db/admin"],
        reason: "Fixture cron that is allowed to load the worker role.",
      },
    ];
    expect(unexpectedForbiddenImports(source, CRON_FIXTURE, allow)).toEqual([]);
    expect(unexpectedForbiddenImports(source, ROUTE_FIXTURE, allow)).toHaveLength(1);
  });

  it("matches the worker-import allowlist on this tree", () => {
    const found = new Map<string, string[]>();
    for (const file of productSourceFiles()) {
      const specs = [...new Set(forbiddenImports(readRepoFile(file)).map((hit) => hit.specifier))].sort();
      if (specs.length) found.set(file, specs);
    }
    const listed = new Map(
      workerImportAllowlist.map((entry) => [entry.file, [...entry.specifiers].sort()]),
    );
    expect([...found.keys()].sort()).toEqual([...listed.keys()].sort());
    for (const [file, specs] of found) {
      expect(listed.get(file), file).toEqual(specs);
    }
  });
});

describe("ESLint request-import ban", () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT });
  });

  async function restricted(code: string, filePath: string) {
    const [result] = await eslint.lintText(code, { filePath });
    const messages = result?.messages ?? [];
    const fatal = messages.filter((message) => message.fatal);
    expect(fatal, fatal.map((message) => message.message).join("\n")).toEqual([]);
    return messages.filter(
      (message) =>
        message.ruleId === "no-restricted-imports" || message.ruleId === "vantage/no-dynamic-worker-import",
    );
  }

  it("flags @vantage/db/admin and @supabase/supabase-js in a route, a lib module, and proxy.ts", async () => {
    const admin = 'import { dbAdmin } from "@vantage/db/admin";\n';
    const supabase = 'import { createClient } from "@supabase/supabase-js";\n';
    const dynamic = 'export async function load() { return import("@vantage/db/admin"); }\n';
    for (const filePath of [
      ROUTE_FIXTURE,
      "apps/web/lib/example-boundary.ts",
      "apps/web/proxy.ts",
      "apps/web/lib/dashboard/example.ts",
    ]) {
      expect(await restricted(admin, filePath), filePath).not.toEqual([]);
    }
    expect(await restricted(supabase, ROUTE_FIXTURE)).not.toEqual([]);
    expect(await restricted(dynamic, ROUTE_FIXTURE)).not.toEqual([]);
  }, 60_000);

  it("does not flag withRls, and still allows the worker role on an allowlisted file", async () => {
    const withRls = 'import { withRls } from "@vantage/db";\nexport const role = withRls;\n';
    expect(await restricted(withRls, ROUTE_FIXTURE)).toEqual([]);
    const admin = 'import { dbAdmin } from "@vantage/db/admin";\nexport const db = dbAdmin;\n';
    expect(await restricted(admin, "packages/reference/src/admin-store.ts")).toEqual([]);
    const dynamicAdmin = 'export async function load() { return import("@vantage/db/admin"); }\n';
    expect(await restricted(dynamicAdmin, "packages/reference/src/admin-store.ts")).toEqual([]);
    expect(await restricted(admin, "packages/billing/src/example.ts")).not.toEqual([]);
    const supabase = 'import { createClient } from "@supabase/supabase-js";\nexport const client = createClient;\n';
    expect(await restricted(supabase, "packages/reference/src/admin-store.ts")).not.toEqual([]);
  }, 60_000);
});

describe("interpolated SQL templates", () => {
  it("flags an untagged template and sql.raw, including a SET clause", () => {
    expect(interpolatedSqlTemplates("client.query(`SELECT * FROM t WHERE id = ${id}`)")).toHaveLength(1);
    expect(interpolatedSqlTemplates("client.query(`UPDATE t SET ${sets.join(\", \")} WHERE id = $1`)")).toHaveLength(1);
    expect(interpolatedSqlTemplates("sql.raw`SELECT ${id} FROM t`")).toHaveLength(1);
  });

  it("does not flag bound parameters, the drizzle sql tag, copy, or a comment", () => {
    expect(interpolatedSqlTemplates("client.query(`SELECT * FROM t WHERE id = $1`, [id])")).toEqual([]);
    expect(interpolatedSqlTemplates("sql`SELECT * FROM t WHERE id = ${id}`")).toEqual([]);
    expect(interpolatedSqlTemplates("`Delete ${name}?`")).toEqual([]);
    expect(interpolatedSqlTemplates("// SELECT ${id} FROM t\nconst ok = 1;\n")).toEqual([]);
  });

  it("flags lowercase select…from and does not flag an English sentence", () => {
    expect(lowercaseSqlTemplates("client.query(`select ${id} from teams`)")).toHaveLength(1);
    expect(lowercaseSqlTemplates("client.query(`delete from teams where id = ${id}`)")).toHaveLength(1);
    expect(lowercaseSqlTemplates("`Delete ${name}?`")).toEqual([]);
    expect(lowercaseSqlTemplates("`Please select ${name} from the menu`")).toEqual([]);
  });

  it("flags concatenated SQL and does not flag ordinary string addition", () => {
    expect(concatenatedSql('client.query("SELECT " + column + " FROM teams")')).toHaveLength(1);
    expect(concatenatedSql('client.query("select id from " + table)')).toHaveLength(1);
    expect(concatenatedSql('const label = "Delete " + name + "?"')).toEqual([]);
    expect(concatenatedSql('const note = "Please select " + name')).toEqual([]);
  });

  it("matches the SQL fragment allowlist on this tree", () => {
    const found = new Set<string>();
    for (const file of productSourceFiles()) {
      for (const hit of unsafeSqlTemplates(readRepoFile(file))) {
        for (const expression of hit.expressions) found.add(`${file}\0${expression}`);
      }
    }
    const listed = new Set(sqlFragmentAllowlist.map((entry) => `${entry.file}\0${entry.expression}`));
    expect([...found].sort()).toEqual([...listed].sort());
  });
});

describe("signed-in admin-pool imports", () => {
  it("flags the platform connector route when its allowlist row is removed", () => {
    const hits = signedInAdminImportHits([]);
    expect(
      hits.some(
        (hit) =>
          hit.file === "apps/web/app/api/admin/data-connectors/route.ts" &&
          hit.module === "apps/web/lib/reference/worker-ingest.ts",
      ),
    ).toBe(true);
  });

  it("allows only the modules named on each row", () => {
    expect(signedInAdminImportHits()).toEqual([]);
    const hits = signedInAdminImportHits([]);
    for (const entry of signedInAdminImportAllowlist) {
      for (const moduleName of entry.modules) {
        expect(hits).toContainEqual({ file: entry.file, module: moduleName });
      }
    }
  });
});

describe("migration bytes", () => {
  it("treats a modify, delete, or rename as a rewrite and an add as an append", () => {
    const diff = [
      "M\tpackages/db/migrations/0001_init.sql",
      "A\tpackages/db/migrations/0999_new.sql",
      "D\tpackages/db/migrations/0002_old.sql",
      "R100\tpackages/db/migrations/0003_a.sql\tpackages/db/migrations/0004_a.sql",
    ].join("\n");
    expect(migrationDrift(diff)).toEqual([
      "M\tpackages/db/migrations/0001_init.sql",
      "D\tpackages/db/migrations/0002_old.sql",
      "R100\tpackages/db/migrations/0003_a.sql\tpackages/db/migrations/0004_a.sql",
    ]);
  });

  it("does not flag an empty diff or a migration that was only added", () => {
    expect(migrationDrift("")).toEqual([]);
    expect(migrationDrift("A\tpackages/db/migrations/0999_new.sql\n")).toEqual([]);
  });

  it("matches packages/db/migrations on origin/main", () => {
    const diff = execFileSync(
      "git",
      ["diff", "--name-status", "-M", "origin/main", "--", "packages/db/migrations"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(migrationDrift(diff)).toEqual([]);
  });
});

describe("withRls role", () => {
  it("flags a withRls that does not SET LOCAL ROLE vantage_app", () => {
    expect(withRlsRoleGaps("export async function withRls() { await client.query(\"BEGIN\"); }")).toEqual([
      "withRls does not SET LOCAL ROLE vantage_app",
    ]);
    expect(withRlsRoleGaps("export function other() {}")).toContain("withRls export is missing");
  });

  it("accepts the role switch and the shipped withRls", () => {
    expect(
      withRlsRoleGaps('export async function withRls() { await client.query("BEGIN; SET LOCAL ROLE vantage_app"); }'),
    ).toEqual([]);
    expect(withRlsRoleGaps(readRepoFile("packages/db/src/index.ts"))).toEqual([]);
  });
});

describe("requestPool outside withRls", () => {
  it("flags requestPool.query and requestPool.connect", () => {
    expect(requestPoolCalls('await requestPool.query<{ a: string; b: number }>("SELECT 1")')).toEqual([
      { line: 1, kind: "query" },
    ]);
    expect(requestPoolCalls("const client = await requestPool.connect();\n")).toEqual([
      { line: 1, kind: "connect" },
    ]);
  });

  it("does not flag a comment or a withRls callback that never touches requestPool", () => {
    expect(requestPoolCalls('// requestPool.query("SELECT 1")\nconst ok = 1;\n')).toEqual([]);
    const source = [
      'import { requestPool, withRls } from "@vantage/db";',
      "export async function GET() {",
      '  return withRls({ userId: "u" }, async (client) => client.query("SELECT 1"));',
      "}",
    ].join("\n");
    expect(requestPoolCalls(source)).toEqual([]);
  });

  it("matches the requestPool allowlist on apps/web", () => {
    const found = new Map<string, number>();
    for (const file of productSourceFiles()) {
      if (!file.startsWith("apps/web/")) continue;
      const hits = requestPoolCalls(readRepoFile(file));
      if (hits.length) found.set(file, hits.length);
    }
    expect([...found.keys()].sort()).toEqual(filesOf(requestPoolAllowlist).sort());
    for (const entry of requestPoolAllowlist) {
      expect(found.get(entry.file), entry.file).toBe(entry.calls);
    }
  });
});

describe("Supabase key reads", () => {
  it("flags Data API env reads", () => {
    const source = [
      "const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;",
      'const anon = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];',
    ].join("\n");
    expect(supabaseKeyReads(source).map((hit) => hit.key)).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
  });

  it("does not flag a comment or the guard that rejects a pasted key", () => {
    expect(supabaseKeyReads("// process.env.NEXT_PUBLIC_SUPABASE_URL\nconst ok = 1;\n")).toEqual([]);
    expect(
      supabaseKeyReads('throw new Error("Value looks like a JWT (anon/service_role). Use the Postgres connection string.");'),
    ).toEqual([]);
  });

  it("finds no Data API key read in product source", () => {
    const hits: string[] = [];
    for (const file of productSourceFiles()) {
      for (const hit of supabaseKeyReads(readRepoFile(file))) {
        hits.push(`${file}:${hit.line} ${hit.key}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("allowlist rows", () => {
  const rows = [
    ...workerImportAllowlist,
    ...requestPoolAllowlist,
    ...sqlFragmentAllowlist,
    ...signedInAdminImportAllowlist,
  ];

  it("names a real file and a reason", () => {
    for (const entry of rows) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(40);
      expect(existsSync(join(REPO_ROOT, entry.file)), entry.file).toBe(true);
    }
  });

  it("does not list the same file twice in one list", () => {
    for (const list of [workerImportAllowlist, requestPoolAllowlist, signedInAdminImportAllowlist]) {
      const files = filesOf(list);
      expect(new Set(files).size).toBe(files.length);
    }
  });

  it("does not list the same SQL expression twice in one file", () => {
    const keys = sqlFragmentAllowlist.map((entry) => `${entry.file}\0${entry.expression}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("worker login password", () => {
  it("binds the password through format and checks the alphabet", () => {
    const source = readRepoFile("scripts/create-worker-login.mjs");
    expect(source.includes("${password}")).toBe(false);
    expect(source).toContain("format('CREATE ROLE vantage_worker_login LOGIN PASSWORD %L IN ROLE vantage_worker', $1::text)");
    expect(source).toContain("/^[A-Za-z0-9_-]+$/");
  });
});
