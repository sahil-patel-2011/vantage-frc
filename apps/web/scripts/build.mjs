/**
 * `next build` behind the production schema gate: a deploy must not ship code
 * that expects tables or columns the production database does not have yet.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_MODE_BUILD_NOTE, checkProductionSchema } from "../../../scripts/production-schema-preflight.mjs";

try {
  const schema = await checkProductionSchema();
  if (schema.backupMode) console.warn(BACKUP_MODE_BUILD_NOTE);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production schema verification failed.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: webRoot,
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
