#!/usr/bin/env -S npx tsx
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AppsScriptBridge, AppsScriptTarget } from "../apps/web/lib/google-sheets/apps-script-bridge";
import { emptyTeamSource } from "../apps/web/lib/google-sheets/sheets-hub";
import { provisionWorkbooks } from "../apps/web/lib/provisioning/workbooks";

async function main() {
  const configPath = process.argv[process.argv.indexOf("--bridge-config") + 1];
  const runPath = process.argv[process.argv.indexOf("--run-file") + 1];
  if (!process.argv.includes("--bridge-config") || !process.argv.includes("--run-file")) throw new Error("Supply private --bridge-config and --run-file paths.");
  const config = JSON.parse(await readFile(resolve(configPath!), "utf8")) as { url: string; secret: string };
  let run: { id: string; createdAt: string };
  try { run = JSON.parse(await readFile(resolve(runPath!), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    run = { id: randomUUID(), createdAt: new Date().toISOString() };
    await writeFile(resolve(runPath!), JSON.stringify(run), { flag: "wx", mode: 0o600 });
  }
  const bridge = new AppsScriptBridge(config.url, config.secret);
  const team = { key: `test-${run.id}`, number: null, name: "Provisioning acceptance test", viewers: [], testRun: run.id };
  const began = Date.now();
  const folder = await bridge.call<{ ok: boolean; folderId: string }>("workspace.ensure", { team });
  const source = emptyTeamSource(team);
  const longNote = "=1+1\n00123 🤖 precision 9007199254740993123456789\n".repeat(1500);
  source.ops = { Tasks: [{ id: run.id, title: "=1+1", status: "open", notes: longNote, source: "acceptance_test", created_at: run.createdAt, updated_at: run.createdAt }] };
  const first = await provisionWorkbooks(bridge, team, source, { onVerified: async (name) => { console.log(JSON.stringify({ phase: "verified workbook", name, elapsedMs: Date.now() - began })); } });
  const initialMs = Date.now() - began;
  const reader = new AppsScriptTarget(bridge, { ...team, rootKey: team.key, key: `${team.key}-Team`, title: "Team" });
  const tasks = await reader.readTable({ sheet: "Tasks", table: "VantageTasks" });
  const notes = tasks?.rows[0]?.[tasks.headers.indexOf("notes") ?? -1];
  // toCell's formula guard remains until normal import decoding.
  if (notes !== "'" + longNote) throw new Error("Long Google values were not restored losslessly.");
  const retried = await provisionWorkbooks(bridge, team, source);
  if (Object.keys(first).length !== 5 || Object.keys(first).some((group) => first[group]!.id !== retried[group]!.id)) throw new Error("Retry produced duplicate or missing workbooks.");
  const proof = { ...run, verifiedAt: new Date().toISOString(), folderId: folder.folderId, initialMs, elapsedMs: Date.now() - began, workbooks: first, retryReusedResources: true, verifiedValues: true, verifiedLongText: true, longTextCharacters: longNote.length, load: "one controlled team; load acceptance remains outstanding" };
  await writeFile(resolve(runPath!), JSON.stringify(proof, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(proof));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Google provisioning verification failed."); process.exitCode = 1; });
