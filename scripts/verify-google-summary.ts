#!/usr/bin/env -S npx tsx
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AppsScriptBridge } from "../apps/web/lib/google-sheets/apps-script-bridge";
import { APPS_SCRIPT_WORKSPACE_VERSION } from "../apps/web/lib/google-sheets/apps-script-source";
import { emptyTeamSource } from "../apps/web/lib/google-sheets/sheets-hub";
import { provisionWorkbooks } from "../apps/web/lib/provisioning/workbooks";

async function main() {
  const argument = (name: string) => {
    const index = process.argv.indexOf(name);
    if (index < 0 || !process.argv[index + 1]) throw new Error(`Supply private ${name}.`);
    return resolve(process.argv[index + 1]!);
  };
  const config = JSON.parse(await readFile(argument("--bridge-config"), "utf8")) as { url: string; secret: string };
  const runPath = argument("--run-file");
  let run: { id: string; createdAt: string };
  try { run = JSON.parse(await readFile(runPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    run = { id: randomUUID(), createdAt: new Date().toISOString() };
    await writeFile(runPath, JSON.stringify(run), { flag: "wx", mode: 0o600 });
  }
  const bridge = new AppsScriptBridge(config.url, config.secret);
  const ping = await bridge.ping({ hub: true });
  if (ping.version < APPS_SCRIPT_WORKSPACE_VERSION) throw new Error("Deploy the required workspace bridge before verifying.");
  // Synthetic resources live under their own stable acceptance namespace. No live
  // organization data, production sheets or unidentified resources are modified.
  const team = { key: `test-${run.id}`, number: null, name: "Summary acceptance test", viewers: [], testRun: run.id };
  await bridge.call("workspace.ensure", { team });
  const source = emptyTeamSource(team);
  source.ops = {
    Finance: [
      { id: "synthetic-income", type: "income", amount_usd: 42.5, counts_in_balance: true, source_kind: "acceptance_test", source_id: "income", updated_at: run.createdAt },
      { id: "synthetic-expense", type: "expense", amount_usd: 7.25, counts_in_balance: true, source_kind: "acceptance_test", source_id: "expense", updated_at: run.createdAt },
      { id: "synthetic-excluded", type: "expense", amount_usd: 500, counts_in_balance: false, source_kind: "acceptance_test", source_id: "excluded", updated_at: run.createdAt },
    ],
  };
  const began = Date.now();
  const resources = await provisionWorkbooks(bridge, team, source, { only: "Business", force: true });
  const business = { ...team, rootKey: team.key, key: `${team.key}-Business`, title: "Business" };
  const read = await bridge.call<{ ok: boolean; values: Record<string, unknown[][]> }>("read", { team: business, sheets: ["Summary", "Finance", "SyncInfo"] });
  const summary = read.values.Summary;
  if (!Array.isArray(summary)) throw new Error("Google Summary read-back is missing.");
  const expected: Record<string, number> = { "Income (USD)": 42.5, "Expenses (USD)": 7.25, "Recorded balance (USD)": 35.25, "Active sponsors": 0 };
  const actual = Object.fromEntries(summary.slice(1).map((row) => [String(row[1]), row[2]]));
  if (Object.keys(actual).length !== Object.keys(expected).length) throw new Error("Business Summary contains out-of-workspace metrics.");
  for (const [measure, value] of Object.entries(expected)) {
    if (actual[measure] !== value) throw new Error(`Google formula calculation mismatch: ${measure}.`);
  }
  const finance = read.values.Finance!;
  const inclusion = finance[0]!.indexOf("counts_in_balance");
  if (inclusion < 0 || finance[3]?.[inclusion] !== false) throw new Error("Excluded ledger inclusion flag was not preserved.");
  const again = await provisionWorkbooks(bridge, team, source, { only: "Business" });
  if (again.Business!.id !== resources.Business!.id) throw new Error("Summary retry created a duplicate book.");
  // Reproduce the old deployed application's Finance schema in this identified
  // test book. Missing inclusion flags must remain unknown, never assumed true.
  try {
    await bridge.call("write", { team: business, items: [{ sheet: "Finance", startRow: 1, width: 3,
      values: [["id", "type", "amount_usd"], ["synthetic-legacy", "expense", 500]], clear: true }] });
    await bridge.stampTeamBook(business, `synthetic-legacy-${run.id}`, ["Finance", "Sponsors", "Tables", "SyncInfo"]);
    const legacy = await bridge.call<{ ok: boolean; values: Record<string, unknown[][]> }>("read", { team: business, sheets: ["Summary", "Finance"] });
    const measures = Object.fromEntries(legacy.values.Summary!.slice(1).map(row => [String(row[1]), row[2]]));
    if (measures["Included ledger totals"] !== "Unavailable"
      || ["Income (USD)", "Expenses (USD)", "Recorded balance (USD)"].some(key => key in measures)
      || legacy.values.Finance?.[1]?.[2] !== 500) throw new Error("Legacy Finance compatibility/read-back failed.");
  } finally {
    // Leave the synthetic test book in the current format even after failure.
    await provisionWorkbooks(bridge, team, source, { only: "Business", force: true });
  }
  const legacyCompatibilityVerified = true;
  const restored = await bridge.call<{ ok: boolean; values: Record<string, unknown[][]> }>("read", { team: business, sheets: ["Summary"] });
  const restoredActual = Object.fromEntries(restored.values.Summary!.slice(1).map(row => [String(row[1]), row[2]]));
  if (Object.entries(expected).some(([key, value]) => restoredActual[key] !== value)) throw new Error("Modern Summary was not restored after the legacy check.");
  const evidence = { ...run, verifiedAt: new Date().toISOString(), elapsedMs: Date.now() - began, bridgeVersion: ping.version, resources, expected, actual, realGoogleCalculation: true, retryReusedResource: true, legacyCompatibilityVerified, modernRestored: true, scope: "one identified synthetic Business workbook; no production database migration or app deployment; no load proof" };
  await writeFile(runPath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ verifiedAt: evidence.verifiedAt, elapsedMs: evidence.elapsedMs, bridgeVersion: ping.version, actual, retryReusedResource: true, legacyCompatibilityVerified, modernRestored: true }));
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Google Summary verification failed.";
  console.error(message.replace(/[a-f0-9]{64}/g, "[credential omitted]").replace(/([?&]sig=)[^&\s]+/g, "$1[omitted]"));
  process.exitCode = 1;
});
