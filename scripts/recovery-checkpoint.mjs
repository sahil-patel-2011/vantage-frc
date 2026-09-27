#!/usr/bin/env node
// Operator checkpoint. Credentials stay in child-process environment; the dump is never
// written to disk unencrypted. pg_dump uses the same exported transaction snapshot as the
// table counts recorded in the manifest.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { rootCertificates } from "node:tls";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { parseEnvFile } from "./deploy-preflight.mjs";

const argument = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
if (!process.argv.includes("--env-file") || !process.argv.includes("--pg-dump")) throw new Error("Supply --env-file and --pg-dump.");
const env = parseEnvFile(await readFile(argument("--env-file"), "utf8"));
const connection = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DATABASE_ADMIN_URL;
if (!connection?.startsWith("postgres") || connection.includes("[SENSITIVE]")) throw new Error("An unpooled database connection is required.");
const directory = resolve(argument("--directory") || join(homedir(), ".codex", "secure", "vantage-recovery"));
await mkdir(directory, { recursive: true });
const keyPath = join(directory, "recovery-key.base64");
let key;
try { key = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64"); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  key = randomBytes(32);
  await writeFile(keyPath, key.toString("base64"), { flag: "wx", mode: 0o600 });
}
if (key.length !== 32) throw new Error("Invalid checkpoint encryption key.");
const caPath = join(directory, "trusted-roots.pem");
await writeFile(caPath, rootCertificates.join("\n"), { mode: 0o600 });
const id = `checkpoint-${new Date().toISOString().replaceAll(":", "-")}`;
const nonce = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, nonce);
cipher.setAAD(Buffer.from(id));
const client = new pg.Client({ connectionString: connection });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = (await client.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
  const tables = (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename")).rows;
  const roles = (await client.query("SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname")).rows.map((row) => row.rolname);
  const counts = {};
  const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
  for (const table of tables) {
    const name = `${quote(table.schemaname)}.${quote(table.tablename)}`;
    counts[`${table.schemaname}.${table.tablename}`] = (await client.query(`SELECT count(*)::text AS count FROM ${name}`)).rows[0].count;
  }
  const digest = createHash("sha256");
  cipher.on("data", (chunk) => digest.update(chunk));
  const database = new URL(connection);
  const child = spawn(resolve(argument("--pg-dump")), ["--format=custom", "--no-owner", "--snapshot", snapshot], {
    env: { ...process.env, PGDATABASE: decodeURIComponent(database.pathname.slice(1)), PGHOST: database.hostname,
      PGPORT: database.port || "5432", PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password),
      PGSSLMODE: database.searchParams.get("sslmode") || "verify-full", PGSSLROOTCERT: caPath }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((accept, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? accept() : reject(new Error(`pg_dump failed (${code}); checkpoint was not accepted. ${stderr.replaceAll(database.toString(), "[database]").slice(-600)}`)));
  });
  await Promise.all([pipeline(child.stdout, cipher, createWriteStream(join(directory, `${id}.encrypted`), { flags: "wx", mode: 0o600 })), completed]);
  await client.query("COMMIT");
  const manifest = { version: 1, id, createdAt: new Date().toISOString(), format: "pg_dump-custom", encryption: "aes-256-gcm", nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), sha256: digest.digest("hex"), tables: counts, roles };
  await writeFile(join(directory, `${id}.manifest.json`), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ id, tableCount: tables.length, directory, status: "encrypted; restore verification required" }));
} finally { key.fill(0); await client.end(); }
