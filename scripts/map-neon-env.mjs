import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let value = line.slice(i + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, i)] = value;
  }
  return out;
}

const env = loadEnv(".env.production.local");
const pooled = env.DATABASE_URL || env.POSTGRES_URL;
const unpooled = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || pooled;
if (!pooled) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}

function add(key, value) {
  const result = spawnSync("vercel", ["env", "add", key, "production", "--yes"], {
    input: `${value}\n`,
    encoding: "utf8",
  });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const ok = result.status === 0 || /already exists|Added/i.test(text);
  console.log(key, ok ? "OK" : "FAIL");
  if (!ok) console.log(text.split(/\r?\n/).slice(0, 6).join(" | "));
}

for (const [key, value] of [
  ["DATABASE_AUTH_URL", pooled],
  ["DATABASE_ADMIN_URL", unpooled],
  ["MARKETING_DATABASE_URL", pooled],
  ["DATABASE_BILLING_URL", pooled],
  ["DATABASE_DISPLAY_URL", pooled],
]) {
  add(key, value);
}

writeFileSync(
  ".env.migrate.local",
  [
    `DATABASE_ADMIN_URL=${JSON.stringify(unpooled)}`,
    `DATABASE_URL=${JSON.stringify(pooled)}`,
    `DATABASE_AUTH_URL=${JSON.stringify(pooled)}`,
  ].join("\n") + "\n",
);
console.log("ALIASES_WRITTEN");
