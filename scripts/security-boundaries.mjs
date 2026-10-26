/**
 * Static checks for the tenancy rules that used to live only in CLAUDE.md and
 * CONTRIBUTING.md.
 *
 * Request code may not import the worker role or a Supabase client. SQL in
 * templates stays parameterized unless it goes through the drizzle `sql` tag.
 * A migration that already exists on main is not edited or renumbered.
 * `withRls` keeps `SET LOCAL ROLE vantage_app`. Public token routes that call
 * `requestPool` directly are named in the allowlist, not forgotten.
 *
 * The scanners are pure: they read source text and return findings. The test
 * and the ESLint config share the banned specifier list so the two checks
 * cannot drift.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { workerImportAllowlist } from "./security-boundary-allowlist.mjs";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "release",
  ".git",
  ".claude",
  ".freebuff",
  "win-kit",
  "lovat-kit",
  "agent-kit",
  "playwright-report",
  "test-results",
  "coverage",
]);

/** Worker modules a request must not load. Messages match the existing lint copy. */
export const REQUEST_IMPORT_PATHS = [
  {
    name: "@vantage/db/admin",
    message: "dbAdmin is worker-only and must never enter request paths.",
  },
  {
    name: "@vantage/reference/admin-store",
    message: "Reference writes are worker-only and must never enter request paths.",
  },
  {
    name: "@vantage/reference/production-worker",
    message: "Reference workers are privileged and must never enter request paths.",
  },
  {
    name: "@vantage/reference/nexus-ingest",
    message: "Nexus ingest is worker-only and must never enter request paths.",
  },
  {
    name: "@vantage/intel-research/production-worker",
    message: "Research sweep workers are privileged and must never enter request paths.",
  },
];

/**
 * Any `@supabase/*` import is the Data API / Auth client. Product tenancy is
 * Postgres through `withRls`, so the ban is the whole scope, not one package.
 */
export const SUPABASE_IMPORT_PATTERNS = [
  {
    group: ["@supabase/*", "supabase"],
    message:
      "Product data uses Postgres through withRls. Do not call the Supabase Data API, Auth, or supabase-js client.",
  },
];

export const PACKAGE_APP_PATTERNS = [
  {
    group: ["apps/*", "**/apps/**"],
    message: "Domain packages must not import apps/web. Put UI in the composition root.",
  },
];

export const FEATURE_BOUNDARY_PATTERNS = [
  {
    group: ["**/lib/scouting/**", "**/lib/messages/**", "**/lib/pit/**", "**/lib/hours/**"],
    message:
      "This feature folder may not import another feature's internals. Put shared helpers in lib/ui, lib/nav, or a package.",
  },
];

const WORKER_SPECIFIERS = new Set(REQUEST_IMPORT_PATHS.map((entry) => entry.name));

const SUPABASE_KEY_ENVS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
];

/**
 * Uppercase, because product SQL is written that way. A sentence that starts
 * with "Delete" is not a statement. `sql`…`` from drizzle binds interpolations;
 * `sql.raw` does not, so only the exact tag `sql` is treated as safe.
 */
const SQL_STATEMENT =
  /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+[A-Za-z_][\w.]*|DELETE\s+FROM|WITH\s+[A-Za-z_][\w]*\s+AS|CREATE\s+(?:TABLE|ROLE|SCHEMA|INDEX|POLICY|UNIQUE)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|POLICY)|TRUNCATE(?:\s+TABLE)?|GRANT\s+|REVOKE\s+|SAVEPOINT|SET\s+LOCAL|ROLLBACK\s+TO)\b/;

const SAFE_SQL_TAGS = new Set(["sql"]);

export function isTestPath(file) {
  return /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(file.replace(/\\/g, "/"));
}

export function isForbiddenSpecifier(specifier) {
  if (WORKER_SPECIFIERS.has(specifier)) return true;
  if (specifier === "supabase" || specifier.startsWith("@supabase/")) return true;
  return false;
}

function isIdent(char) {
  return char !== undefined && /[\w$]/.test(char);
}

function skipSpaceAndComments(source, index) {
  let i = index;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      i += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function readQuoted(source, index) {
  const quote = source[index];
  if (quote !== '"' && quote !== "'") return null;
  let i = index + 1;
  let value = "";
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      value += source[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (char === quote) return { value, next: i + 1 };
    if (char === "\n") return null;
    value += char;
    i += 1;
  }
  return null;
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function keywordAt(source, index, word) {
  if (!source.startsWith(word, index)) return false;
  if (index > 0 && isIdent(source[index - 1])) return false;
  if (isIdent(source[index + word.length])) return false;
  return true;
}

/**
 * Import and require specifiers, ignoring comments and ordinary strings.
 * `import("pkg")`, `require("pkg")`, and `export … from "pkg"` all count:
 * a dynamic import is how the worker client was reaching signed-in routes
 * without the static lint rule noticing.
 */
export function importSpecifiers(source) {
  const found = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const quoted = readQuoted(source, i);
      i = quoted ? quoted.next : i + 1;
      continue;
    }
    if (char === "`") {
      i = skipTemplate(source, i).next;
      continue;
    }
    if (keywordAt(source, i, "import")) {
      const start = i;
      let k = skipSpaceAndComments(source, i + "import".length);
      if (source[k] === "(") {
        k = skipSpaceAndComments(source, k + 1);
        const quoted = readQuoted(source, k);
        if (quoted) {
          found.push({ specifier: quoted.value, line: lineAt(source, start), kind: "dynamic" });
          i = quoted.next;
          continue;
        }
      }
      if (source[k] === '"' || source[k] === "'") {
        const quoted = readQuoted(source, k);
        if (quoted) {
          found.push({ specifier: quoted.value, line: lineAt(source, start), kind: "import" });
          i = quoted.next;
          continue;
        }
      }
      const from = readFromSpecifier(source, k);
      if (from) {
        found.push({ specifier: from.value, line: lineAt(source, start), kind: "import" });
        i = from.next;
        continue;
      }
    }
    if (keywordAt(source, i, "export")) {
      const start = i;
      const from = readFromSpecifier(source, i + "export".length);
      if (from) {
        found.push({ specifier: from.value, line: lineAt(source, start), kind: "export" });
        i = from.next;
        continue;
      }
    }
    if (keywordAt(source, i, "require")) {
      const start = i;
      let k = skipSpaceAndComments(source, i + "require".length);
      if (source[k] === "(") {
        k = skipSpaceAndComments(source, k + 1);
        const quoted = readQuoted(source, k);
        if (quoted) {
          found.push({ specifier: quoted.value, line: lineAt(source, start), kind: "require" });
          i = quoted.next;
          continue;
        }
      }
    }
    i += 1;
  }
  return found;
}

function readFromSpecifier(source, index) {
  let i = index;
  const end = Math.min(source.length, index + 2000);
  while (i < end) {
    if (source[i] === ";") return null;
    if (source[i] === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (keywordAt(source, i, "from")) {
      const k = skipSpaceAndComments(source, i + "from".length);
      return readQuoted(source, k);
    }
    i += 1;
  }
  return null;
}

function skipTemplate(source, index) {
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "`") return { next: i + 1 };
    if (source[i] === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") depth -= 1;
        if (depth > 0) i += 1;
        else break;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return { next: i };
}

export function forbiddenImports(source) {
  return importSpecifiers(source).filter((hit) => isForbiddenSpecifier(hit.specifier));
}

/**
 * Findings that are not on this file's allowlist entry. An entry permits only
 * the specifiers it names; a new worker import in an already-listed file still
 * fails.
 */
export function unexpectedForbiddenImports(source, file, allowlist) {
  const entry = allowlist.find((item) => item.file === file);
  const allowed = new Set(entry?.specifiers ?? []);
  return forbiddenImports(source).filter((hit) => !allowed.has(hit.specifier));
}

export function scanTemplates(source) {
  const found = [];
  let i = 0;
  let line = 1;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const quoted = readQuoted(source, i);
      if (!quoted) {
        i += 1;
        continue;
      }
      i = quoted.next;
      continue;
    }
    if (char === "`") {
      let j = i - 1;
      while (j >= 0 && (source[j] === " " || source[j] === "\t")) j -= 1;
      const tagEnd = j;
      while (j >= 0 && /[\w$.]/.test(source[j])) j -= 1;
      const tag = source.slice(j + 1, tagEnd + 1);
      const startLine = line;
      i += 1;
      let staticText = "";
      const expressions = [];
      while (i < source.length) {
        if (source[i] === "\\") {
          staticText += source[i];
          i += 2;
          continue;
        }
        if (source[i] === "`") {
          i += 1;
          break;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          i += 2;
          const start = i;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === "\n") line += 1;
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            if (depth > 0) i += 1;
            else break;
          }
          expressions.push(source.slice(start, i).replace(/\s+/g, " ").trim());
          i += 1;
          continue;
        }
        if (source[i] === "\n") line += 1;
        staticText += source[i];
        i += 1;
      }
      found.push({ tag, line: startLine, expressions, staticText });
      continue;
    }
    i += 1;
  }
  return found;
}

export function interpolatedSqlTemplates(source) {
  return scanTemplates(source).filter(
    (template) =>
      template.expressions.length > 0 &&
      !SAFE_SQL_TAGS.has(template.tag) &&
      SQL_STATEMENT.test(template.staticText),
  );
}

export function requestPoolCalls(source) {
  const hits = [];
  // The type arguments can contain semicolons (`query<{ a: string; b: number }>`),
  // and the call is sometimes split across a line (`requestPool\n.query`). Match
  // the member access itself; comments are already blanked.
  const pattern = /\brequestPool\s*\.\s*(query|connect)\b/g;
  const code = blankComments(source);
  for (const match of code.matchAll(pattern)) {
    hits.push({ line: lineAt(source, match.index ?? 0), kind: match[1] });
  }
  return hits;
}

export function supabaseKeyReads(source) {
  const hits = [];
  const code = blankComments(source);
  for (const key of SUPABASE_KEY_ENVS) {
    const pattern = new RegExp(
      `process\\.env\\s*(?:\\.\\s*${key}|\\[\\s*["']${key}["']\\s*\\])`,
      "g",
    );
    for (const match of code.matchAll(pattern)) {
      hits.push({ line: lineAt(source, match.index ?? 0), key });
    }
  }
  return hits;
}

function blankComments(source) {
  const out = source.split("");
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") out[index++] = " ";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; index < stop; index += 1) if (source[index] !== "\n") out[index] = " ";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

export function withRlsRoleGaps(source) {
  const gaps = [];
  if (!/export\s+async\s+function\s+withRls\b/.test(source)) {
    gaps.push("withRls export is missing");
  }
  if (!source.includes("SET LOCAL ROLE vantage_app")) {
    gaps.push("withRls does not SET LOCAL ROLE vantage_app");
  }
  return gaps;
}

/**
 * `git diff --name-status -M` lines for `packages/db/migrations`.
 * An added file is an append. A modify, delete, or rename is a rewrite.
 */
export function migrationDrift(nameStatusText) {
  const violations = [];
  for (const line of nameStatusText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const status = trimmed.split("\t")[0] ?? "";
    if (status.startsWith("A")) continue;
    violations.push(trimmed);
  }
  return violations;
}

export function walkSourceFiles(rootDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(name)) continue;
      const rel = relative(rootDir, full).replace(/\\/g, "/");
      if (isTestPath(rel)) continue;
      out.push(rel);
    }
  }
  walk(rootDir);
  return out.sort();
}

export function readRepoFile(file) {
  return readFileSync(join(REPO_ROOT, file), "utf8");
}

export function productSourceFiles() {
  return ["apps", "packages", "scripts"].flatMap((dir) =>
    walkSourceFiles(join(REPO_ROOT, dir)).map((file) => `${dir}/${file}`),
  );
}

export function isAllowlistedSpecifier(filename, specifier, allowlist = workerImportAllowlist) {
  const norm = filename.replace(/\\/g, "/");
  const entry = allowlist.find((item) => norm === item.file || norm.endsWith(`/${item.file}`));
  return entry?.specifiers.includes(specifier) ?? false;
}

/**
 * `no-restricted-imports` flags static `import`/`export` and, in this ESLint,
 * does not flag `import()`. The worker client was reaching signed-in routes
 * through `import()`, so this rule covers that form. The allowlist is the
 * same list the static override uses.
 */
export const vantageSecurityPlugin = {
  rules: {
    "no-dynamic-worker-import": {
      meta: {
        type: "problem",
        docs: {
          description: "Ban import() of the worker role and Supabase clients.",
        },
        schema: [],
        messages: {
          banned:
            "{{specifier}} is worker-only or a Supabase client and must not be loaded from request code.",
        },
      },
      create(context) {
        return {
          ImportExpression(node) {
            const source = node.source;
            if (!source || source.type !== "Literal" || typeof source.value !== "string") return;
            if (!isForbiddenSpecifier(source.value)) return;
            const filename = context.filename ?? context.getFilename?.() ?? "";
            if (isAllowlistedSpecifier(filename, source.value)) return;
            context.report({
              node,
              messageId: "banned",
              data: { specifier: source.value },
            });
          },
        };
      },
    },
  },
};

/**
 * ESLint override for one allowlisted file. Worker specifiers named on the
 * entry are omitted; Supabase, cross-package, and feature-boundary bans stay.
 */
export function allowlistedImportRule(entry) {
  return [
    "error",
    {
      paths: REQUEST_IMPORT_PATHS.filter((path) => !entry.specifiers.includes(path.name)),
      patterns: [...SUPABASE_IMPORT_PATTERNS, ...PACKAGE_APP_PATTERNS, ...FEATURE_BOUNDARY_PATTERNS],
    },
  ];
}
