import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function loadEnv(path) {
  const out = {};
  try {
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
  } catch {
    // optional file
  }
  return out;
}

const env = { ...loadEnv(".env.production.local"), ...loadEnv(".env.migrate.local"), ...loadEnv(".env.local") };
const pooled = env.DATABASE_URL || env.POSTGRES_URL;
const unpooled = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || pooled;
if (!pooled) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}

function add(key, value, targets = ["production", "preview", "development"]) {
  for (const target of targets) {
    const result = spawnSync("vercel", ["env", "add", key, target, "--yes"], {
      input: `${value}\n`,
      encoding: "utf8",
      shell: true,
    });
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    console.log(key, target, /Added|✓/i.test(text) ? "ADDED" : /already/i.test(text) ? "EXISTS" : `FAIL:${result.status}`);
  }
}

add("DATABASE_AUTH_URL", pooled);
add("DATABASE_ADMIN_URL", unpooled);
add("MARKETING_DATABASE_URL", pooled);
add("DATABASE_BILLING_URL", pooled);
add("DATABASE_DISPLAY_URL", pooled);
console.log("ALIAS_PUSH_DONE");
