// Dev server against a LOCAL Postgres (real Better Auth sessions, real RLS),
// so the whole product can be walked without touching the hosted database.
// Expects the migrated roles to be LOGIN-enabled with password "local"
// (see scripts/local-db-roles.sql) on localhost:5432/vantage.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.argv[2] || "3403";
const host = process.env.LOCAL_PG_HOST || "localhost:5432/vantage";
const url = (role) => `postgresql://${role}:local@${host}`;
const preload = path.join(here, "dirent-onedrive-fix.cjs");
const nodeOptions = [process.env.NODE_OPTIONS, `--require=${JSON.stringify(preload)}`].filter(Boolean).join(" ");

const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions,
  DATABASE_DRIVER: "pg",
  DATABASE_URL: url("vantage_app"),
  DATABASE_AUTH_URL: url("vantage_auth"),
  DATABASE_ADMIN_URL: url("vantage_worker"),
  DATABASE_URL_UNPOOLED: url("vantage_worker"),
  DATABASE_BILLING_URL: url("vantage_app"),
  DATABASE_DISPLAY_URL: url("vantage_app"),
  DATABASE_ALLIANCE_BOARD_URL: url("vantage_app"),
  MARKETING_DATABASE_URL: url("vantage_marketing"),
  POSTGRES_URL: url("vantage_app"),
  POSTGRES_URL_NON_POOLING: url("vantage_worker"),
  POSTGRES_PRISMA_URL: url("vantage_app"),
  POSTGRES_URL_NO_SSL: url("vantage_app"),
  PGHOST: "localhost",
  PGHOST_UNPOOLED: "localhost",
  PGUSER: "vantage_app",
  PGPASSWORD: "local",
  PGDATABASE: "vantage",
  BETTER_AUTH_SECRET: process.env.LOCAL_AUTH_SECRET || "local-development-secret-change-me",
  BETTER_AUTH_URL: `http://localhost:${port}`,
  NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
  NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
  VERCEL: "",
  VERCEL_ENV: "",
  E2E_AUTH_FIXTURE: "",
};

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", "--port", port], {
  cwd: path.join(here, "..", "apps", "web"),
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});
child.on("exit", (code) => process.exit(code ?? 0));
