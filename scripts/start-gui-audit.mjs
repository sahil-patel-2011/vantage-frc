#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = resolve(root, "apps/web");
const mode = process.argv.includes("--build") ? "build" : process.argv.includes("--production") ? "start" : "dev";
const databaseFree = process.argv.includes("--database-free");
const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3419";
const target = new URL(origin);
if (target.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(target.hostname)
  || !target.port || target.pathname !== "/" || target.search || target.hash || target.username || target.password) {
  throw new Error("GUI audit requires a plain loopback HTTP origin with an explicit port.");
}
const keys = ["DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_ADMIN_URL"];
for (const key of databaseFree ? [] : keys) {
  const url = new URL(process.env[key] ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(decodeURIComponent(url.pathname.slice(1)))
    || ["host", "hostaddr", "service"].some(name => url.searchParams.has(name))) {
    throw new Error(`${key} must identify a dedicated loopback test database.`);
  }
}
// Next reads local env files even when the runner supplies its own process env.
// Mask their keys without logging their contents; no inherited provider credentials.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|Path|SystemRoot|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|NUMBER_OF_PROCESSORS)$/i.test(key),
));
for (const directory of [root, web]) {
  for (const name of readdirSync(directory).filter(name => /^\.env(?:\.|$)/.test(name))) {
    for (const match of readFileSync(resolve(directory, name), "utf8").matchAll(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=/gm)) {
      env[match[1]] = "";
    }
  }
}
Object.assign(env, {
  NODE_ENV: mode === "dev" ? "development" : "production",
  CI: "true",
  E2E_AUTH_FIXTURE: mode === "dev" ? "1" : "",
  VANTAGE_BROWSER_DIST_DIR: databaseFree ? mode === "dev" ? ".next/ui-audit" : ".next/ui-build" : ".next/browser-tests/9-20260929-1",
  NODE_OPTIONS: "--max-old-space-size=4096",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_DRIVER: "pg",
  DATABASE_URL: databaseFree ? "" : process.env.DATABASE_URL,
  DATABASE_AUTH_URL: databaseFree ? "" : process.env.DATABASE_AUTH_URL,
  DATABASE_ADMIN_URL: databaseFree ? "" : process.env.DATABASE_ADMIN_URL,
  DATABASE_URL_UNPOOLED: databaseFree ? "" : process.env.DATABASE_URL,
  MARKETING_DATABASE_URL: "",
  BETTER_AUTH_SECRET: "isolated-gui-audit-local-only-secret-2026",
  DEV_OTP_SECRET: "isolated-gui-audit-local-only-otp",
  DEV_KMS_MASTER_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  BETTER_AUTH_URL: target.origin,
  BETTER_AUTH_URL_LOCAL: target.origin,
  NEXT_PUBLIC_APP_URL: target.origin,
  NEXT_PUBLIC_SITE_URL: target.origin,
  NEXT_PUBLIC_VANTAGE_ORIGIN: "",
  NEXT_PUBLIC_SCOUTING_ORIGIN: "",
  AUTH_TRUSTED_ORIGINS: `http://localhost:${target.port},http://127.0.0.1:${target.port}`,
  VANTAGE_PUBLIC_SIGNUP: "",
  VANTAGE_PRODUCTION_VERIFIED: "0",
  VANTAGE_LOCAL_ACCEPTANCE_SIGNUP: "0",
});
delete env.VERCEL_URL;
const args = mode === "build" ? ["build"] : [mode, "--hostname", target.hostname, "--port", target.port];
const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), ...args], {
  cwd: web, env, stdio: "inherit",
});
console.log(`Isolated GUI audit ${mode} at ${target.origin}; ${databaseFree ? "database connections disabled, " : ""}external credentials masked, signup closed.`);
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
