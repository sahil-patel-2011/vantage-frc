#!/usr/bin/env -S npx tsx
// Operator-only recovery transfer. Secrets, archives and downloaded records stay in
// the private directory; stdout contains verification metadata only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { AppsScriptBridge } from "../apps/web/lib/google-sheets/apps-script-bridge";
import { EnvKeyKmsService } from "@vantage/billing";
import { readRecoveryRecord, writeRecoveryRecord } from "../apps/web/lib/recovery/sheets";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main() {
  const configPath = argument("--bridge-config");
  if (!configPath) throw new Error("Supply --bridge-config pointing to a private operator configuration.");
  const config = JSON.parse(await readFile(resolve(configPath), "utf8")) as { url: string; secret: string };
  const bridge = new AppsScriptBridge(config.url, config.secret);
  const ping = await bridge.ping({ hub: true });
  if (ping.version < 5) throw new Error("Deploy bridge version 5 before recovery verification.");
  if (process.argv.includes("--ping")) {
    console.log(JSON.stringify({ status: "verified", bridgeVersion: ping.version, hub: ping.hub }));
    return;
  }
  const keyPath = argument("--key-file");
  if (!keyPath) throw new Error("Supply the separately held --key-file.");
  const kms = new EnvKeyKmsService((await readFile(resolve(keyPath), "utf8")).trim());
  const manifestPath = argument("--manifest");
  const receiptPath = argument("--receipt");
  if (manifestPath) {
    const path = resolve(manifestPath);
    const manifest = JSON.parse(await readFile(path, "utf8")) as { id: string; createdAt: string; sha256: string; tables: Record<string, string> };
    const restoreProof = JSON.parse(await readFile(join(dirname(path), `${manifest.id}.restore-proof.json`), "utf8"));
    if (restoreProof.checkpoint !== manifest.id || restoreProof.countsMatch !== true) throw new Error("Verify the isolated restore before publishing its checkpoint.");
    const archive = await readFile(join(dirname(path), `${manifest.id}.encrypted`));
    if (createHash("sha256").update(archive).digest("hex") !== manifest.sha256) throw new Error("Checkpoint integrity failed.");
    // Stable identity makes interrupted uploads overwrite the same protected record.
    const digest = createHash("sha256").update(manifest.id).digest("hex");
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const bookKey = `Snapshot-${manifest.createdAt.slice(0, 10)}-${id.slice(0, 8)}`;
    const text = JSON.stringify({ version: 1, kind: "snapshot", id, manifest, archive: archive.toString("base64") });
    const testRun = argument("--test-run");
    const resource = await writeRecoveryRecord(bridge, bookKey, id, text, kms, testRun ? { testRun } : {});
    const receipt = { version: 1, kind: "snapshot", checkpoint: manifest.id, createdAt: manifest.createdAt, verifiedAt: new Date().toISOString(), tables: Object.keys(manifest.tables).length, resource };
    await writeFile(join(dirname(path), `${manifest.id}.google-receipt.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: "Google write and read-back verified", checkpoint: manifest.id, tables: receipt.tables, spreadsheetId: resource.spreadsheetId }));
  } else if (receiptPath) {
    const receipt = JSON.parse(await readFile(resolve(receiptPath), "utf8")) as { resource: { bookKey: string; id: string; testRun?: string } };
    const text = await readRecoveryRecord(bridge, receipt.resource.bookKey, receipt.resource.id, kms, receipt.resource.testRun ? { testRun: receipt.resource.testRun } : {});
    const snapshot = JSON.parse(text) as { version: number; kind: string; id: string; manifest: { id: string; sha256: string }; archive: string };
    if (snapshot.version !== 1 || snapshot.kind !== "snapshot" || snapshot.id !== receipt.resource.id || !/^checkpoint-[\w.-]+$/.test(snapshot.manifest.id)) throw new Error("Invalid Google snapshot.");
    const archive = Buffer.from(snapshot.archive, "base64");
    if (createHash("sha256").update(archive).digest("hex") !== snapshot.manifest.sha256) throw new Error("Downloaded checkpoint integrity failed.");
    const destination = resolve(argument("--destination") || join(dirname(resolve(receiptPath)), "google-only-restore"));
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, `${snapshot.manifest.id}.encrypted`), archive, { mode: 0o600 });
    await writeFile(join(destination, `${snapshot.manifest.id}.manifest.json`), JSON.stringify(snapshot.manifest, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: "Google-only download verified", checkpoint: snapshot.manifest.id, destination }));
  } else throw new Error("Supply --ping, --manifest for upload, or --receipt for a Google-only download.");
}

main().catch((error: unknown) => {
  // Bridge errors contain public messages; never dump the signed request or config.
  console.error(error instanceof Error ? error.message : "Recovery transfer failed.");
  process.exitCode = 1;
});
