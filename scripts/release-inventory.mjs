import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const excluded = new Set(["node_modules", ".next", ".git", "win-kit", "lovat-kit", "agent-kit"]);
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    excluded.has(entry.name) ? [] : entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}
const paths = files(join(root, "apps/web/app"));
const local = (path) => relative(root, path).replaceAll("\\", "/");
const routes = paths.filter((path) => /(?:page\.tsx|route\.ts)$/.test(path)).map((path) => ({
  path: local(path),
  route: `/${local(path).replace(/^apps\/web\/app\//, "").replace(/\/(page\.tsx|route\.ts)$/, "").replace(/^(page\.tsx|route\.ts)$/, "").replace(/\([^/]+\)\//g, "")}`,
  kind: path.endsWith("route.ts") ? "api" : "page",
  methods: [...readFileSync(path, "utf8").matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((match) => match[1]),
}));
const manifests = files(join(root, "apps/web/lib/manifests")).filter((path) => path.endsWith(".manifest.ts")).map((path) => {
  const source = readFileSync(path, "utf8");
  return { path: local(path), slug: /slug:\s*["']([^"']+)/.exec(source)?.[1], tables: [...(source.match(/tables:\s*\[([^\]]*)\]/s)?.[1] ?? "").matchAll(/["']([^"']+)/g)].map((match) => match[1]) };
});
const migrations = files(join(root, "packages/db/migrations")).filter((path) => path.endsWith(".sql"));
const tables = [...new Set(migrations.flatMap((path) => [...readFileSync(path, "utf8").matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([a-z][a-z0-9_]*)/gi)].map((match) => match[1])))].sort();
const cron = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).crons ?? [];
const workflows = ["home-saved-boards", "event-day", "scouting-collection", "scouting-analysis", "scouting-partner-sharing", "canonical-work", "chat-playbook", "purchasing-stock-repairs", "pit-batteries", "cad-code", "learning", "finance-ledger", "sponsors-grants", "people-logistics", "account-administration", "team-provisioning", "google-recovery", "personal-codex", "age-policy-deletion", "media-removal"];
const connectorRoots = ["packages/connector/src", "packages/cad/src", "packages/cad-cli/src", "apps/web/lib/integrations", "apps/web/lib/ai-bridge", "apps/web/lib/google-sheets", "apps/web/lib/microsoft"];
const connectors = connectorRoots.map((directory) => ({ directory, sources: existsSync(join(root, directory)) ? files(join(root, directory)).filter((path) => /\.(?:ts|tsx|mjs)$/.test(path) && !path.endsWith(".test.ts")).map(local) : [] }));
const jobRoutes = routes.filter((route) => route.route.startsWith("/api/cron/")).map((route) => ({ ...route, schedules: cron.filter((job) => job.path.split("?")[0] === route.route).map((job) => ({ path: job.path, schedule: job.schedule })) }));
const durableWorkflows = files(join(root, "apps/web/lib")).filter((path) => path.endsWith(".ts") && /["']use workflow["']/.test(readFileSync(path, "utf8"))).map(local);
const result = { schemaVersion: 3, generatedAt: new Date().toISOString(), summary: { pages: routes.filter((row) => row.kind === "page").length, apis: routes.filter((row) => row.kind === "api").length, manifests: manifests.length, coreWorkflows: workflows.length, historicalTables: tables.length, scheduledJobs: cron.length, cronRoutes: jobRoutes.length, durableWorkflows: durableWorkflows.length, connectorRoots: connectors.length }, routes, manifests, workflows, historicalTables: tables, connectors, jobRoutes, durableWorkflows, scheduledJobs: cron };
mkdirSync(join(root, "docs/release"), { recursive: true });
writeFileSync(join(root, "docs/release/inventory.json"), `${JSON.stringify(result, null, 2)}\n`);
const dimensions = "Real data | Permissions | Actions | Failures | Mobile | Offline | Backup | Evidence";
const matrixPath = join(root, "docs/release/completion-matrix.md");
const previousRows = new Map((existsSync(matrixPath) ? readFileSync(matrixPath, "utf8") : "").split("\n").filter((line) => line.startsWith("| ")).map((line) => [line.split("|")[1].trim(), line]));
const names = [...new Set([...workflows, ...manifests.map((row) => row.slug ?? row.path)])];
writeFileSync(matrixPath, `# Production completion matrix\n\nGenerated inventory: ${JSON.stringify(result.summary)}. Historical table names are not proof of the current database schema.\n\nAn unchecked item is unverified, not a passing feature. Record test names and deployed evidence before marking it complete. A partial test is evidence for that dimension only, not acceptance of the entire workflow.\n\n| Feature | ${dimensions} |\n|---|${"---|".repeat(8)}\n${names.map((name) => previousRows.get(name) ?? `| ${name} | ${"Pending | ".repeat(8)}`).join("\n")}\n`);
process.stdout.write(`${JSON.stringify(result.summary)}\n`);
