#!/usr/bin/env node
// Run the built app against scratch data, without allowing Next's production
// env file to supply any database or public-release settings.
import { loadEnvFile } from "node:process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = resolve(root, "apps/web");
loadEnvFile(resolve(web, ".env.development.local"));
const aliases = ["DATABASE_AUTH_URL", "DATABASE_URL", "POSTGRES_URL", "DATABASE_ADMIN_URL",
  "DATABASE_WORKER_URL", "DATABASE_PAIRING_URL", "DATABASE_AI_BRIDGE_URL", "DATABASE_TRAINING_URL",
  "MARKETING_DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"];
for (const key of aliases) {
  const value = process.env[key]?.trim();
  if (!value) { process.env[key] = ""; continue; }
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/(?:^|_)test(?:_|$)/.test(decodeURIComponent(url.pathname.slice(1)))
    || ["host", "hostaddr", "service"].some(key => url.searchParams.has(key))) {
    throw new Error(`${key} must identify a dedicated loopback test database.`);
  }
}
if (!process.env.DATABASE_URL || !process.env.DATABASE_AUTH_URL) throw new Error("Scratch app and auth database URLs are required.");
for (const key of ["BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"]) {
  if (process.env[key] !== "http://127.0.0.1:3417") throw new Error(`${key} must use the local acceptance origin.`);
}
process.env.NODE_ENV = "production";
process.env.VERCEL = "0";
// Workflow checks whether VERCEL_URL is defined, so an empty value still
// selects Vercel and constructs an invalid https:// callback URL locally.
const productionEnvText = await readFile(resolve(web, ".env.local"), "utf8").catch(() => "");
if (/^\s*VERCEL_URL\s*=/m.test(productionEnvText)) {
  throw new Error("The local acceptance runner requires deployment URL metadata to be absent from .env.local.");
}
delete process.env.VERCEL_URL;
process.env.VERCEL_ENV = "";
process.env.PORT = "3417";
process.env.VANTAGE_LOCAL_ACCEPTANCE_SIGNUP = "0";
process.env.VANTAGE_PUBLIC_SIGNUP = "";
process.env.VANTAGE_PRODUCTION_VERIFIED = "0";
process.env.WORKFLOW_LOCAL_BASE_URL = "http://127.0.0.1:3417";
await readFile(resolve(web, ".next/BUILD_ID"));
console.log("Starting built acceptance app on loopback port 3417 with validated scratch database aliases. Signup remains closed.");
const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "3417"], {
  cwd: web, env: process.env, stdio: "inherit",
});
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
