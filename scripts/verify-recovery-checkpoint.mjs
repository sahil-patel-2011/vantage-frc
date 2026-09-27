#!/usr/bin/env node
// Destructive only inside a freshly created local recovery_test database. The script
// never drops schemas or existing databases. It refuses a populated target.
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createHash, createDecipheriv } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import pg from "pg";

const argument = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const target = process.env.TEST_RESTORE_DATABASE_URL;
if (!target) throw new Error("Set TEST_RESTORE_DATABASE_URL to a new local recovery_test database.");
const url = new URL(target);
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || !/recovery_test/.test(url.pathname) || process.env.NODE_ENV === "production") throw new Error("Refusing an unsafe restore target.");
const manifestPath = resolve(argument("--manifest"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const archive = join(dirname(manifestPath), `${manifest.id}.encrypted`);
const key = Buffer.from((await readFile(argument("--key-file") || join(dirname(manifestPath), "recovery-key.base64"), "utf8")).trim(), "base64");
const digest = createHash("sha256");
for await (const chunk of createReadStream(archive)) digest.update(chunk);
if (digest.digest("hex") !== manifest.sha256) throw new Error("Encrypted checkpoint integrity check failed.");
const client = new pg.Client({ connectionString: target });
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
await client.connect();
try {
  if ((await client.query("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') LIMIT 1")).rowCount) throw new Error("Restore database is not empty.");
  for (const name of manifest.roles ?? []) {
    if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [name])).rowCount) await client.query(`CREATE ROLE ${quote(name)} NOLOGIN`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(manifest.nonce, "base64"));
  decipher.setAAD(Buffer.from(manifest.id));
  decipher.setAuthTag(Buffer.from(manifest.authTag, "base64"));
  const child = spawn(resolve(argument("--pg-restore")), ["--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", "--dbname", decodeURIComponent(url.pathname.slice(1))], {
    env: { ...process.env, PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGHOST: url.hostname,
      PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: "disable" },
    windowsHide: true, stdio: ["pipe", "ignore", "pipe"],
  });
  // pg_restore needs -d for database restore instead of rendering SQL to stdout.
  // It receives no connection secret in process arguments.
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const completed = new Promise((accept, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? accept() : reject(new Error(`Restore failed (${code}): ${errors.slice(-1200)}`)));
  });
  await Promise.all([pipeline(createReadStream(archive), decipher, child.stdin), completed]);
  const differences = [];
  for (const [name, expected] of Object.entries(manifest.tables)) {
    const [schema, table] = name.split(".");
    const actual = (await client.query(`SELECT count(*)::text AS count FROM ${quote(schema)}.${quote(table)}`)).rows[0].count;
    if (actual !== expected) differences.push(name);
  }
  if (differences.length) throw new Error(`Restored row counts differ in ${differences.length} tables.`);
  const proof = { checkpoint: manifest.id, verifiedAt: new Date().toISOString(), tableCount: Object.keys(manifest.tables).length, countsMatch: true, target: url.pathname.slice(1), status: "isolated restore verified; access remains closed" };
  await writeFile(join(dirname(manifestPath), `${manifest.id}.restore-proof.json`), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally { key.fill(0); await client.end(); }
