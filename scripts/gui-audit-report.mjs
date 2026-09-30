#!/usr/bin/env node
/**
 * Render the GUI test agent's raw census into a report a human can act on.
 *
 * The census is one row per surface per viewport. What a person needs from it
 * is not 300 rows — it is the ranked list of places that cost the most
 * attention, the list that actually breaks, and the honest denominators, so the
 * thing cannot quietly look finished because rows were dropped.
 *
 *   node scripts/gui-audit-report.mjs [test-results/gui-audit]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "test-results/gui-audit";
const censusPath = join(dir, "census.json");
if (!existsSync(censusPath)) {
  console.error(`No census at ${censusPath}. Run GUI_AUDIT=1 npm run test:browser -- tests/browser/gui-audit.spec.ts first.`);
  process.exit(1);
}
const census = JSON.parse(readFileSync(censusPath, "utf8"));
const rows = census.rows ?? [];
const live = rows.filter((row) => row.disposition !== "not-run");
const desktop = live.filter((row) => row.width >= 1024);

const tally = (list) => list.length;
const byRoute = new Map();
for (const row of live) {
  const entry = byRoute.get(row.route) ?? { route: row.route, controls: 0, buttons: 0, worst: [] };
  entry.controls = Math.max(entry.controls, row.controls);
  entry.buttons = Math.max(entry.buttons, row.buttons);
  entry.worst.push({ width: row.width, buttons: row.buttons, controls: row.controls });
  byRoute.set(row.route, entry);
}

const failed = live.filter((row) => row.disposition === "failed");
const unsettled = live.filter((row) => row.disposition === "unsettled");
const setup = live.filter((row) => row.disposition === "setup-or-unavailable");
const overflow = live.filter((row) => row.overflow);
const unnamed = live.filter((row) => row.names?.missing > 0);
const duplicated = live.filter((row) => row.names?.duplicated > 0);
const axe = live.filter((row) => (row.axe ?? []).length > 0);
const runtime = live.filter((row) => (row.runtime ?? []).length > 0);
const thin = live.filter((row) => row.textLength < 400);

const ranked = [...byRoute.values()].sort((a, b) => b.buttons - a.buttons);
const totalButtons = desktop.reduce((sum, row) => sum + row.buttons, 0);
const totalControls = desktop.reduce((sum, row) => sum + row.controls, 0);
const meanButtons = desktop.length ? totalButtons / desktop.length : 0;

const line = [];
line.push("# GUI test agent — census");
line.push("");
line.push(`Run complete: **${census.complete ? "yes" : "NO — incomplete"}**`);
line.push(`Surfaces planned: ${census.scope?.universe ?? "?"} · walked: ${tally(live)} route/viewport rows over ${byRoute.size} routes`);
line.push(`Viewports: ${(census.scope?.widths ?? []).join(", ")} · axe: ${census.scope?.axe ? "on" : "off"}`);
line.push(`Account: team ${census.identity?.teamNumber ?? "?"}, ${census.identity?.role ?? "?"}`);
line.push("");
line.push("> Rendering, control census, accessibility and navigation evidence only. No row is a functional acceptance result.");
line.push("");

line.push("## Disposition");
line.push("");
line.push("| Outcome | Rows |");
line.push("| --- | --- |");
line.push(`| Rendered | ${live.filter((r) => r.disposition === "rendered").length} |`);
line.push(`| Setup / intentionally unavailable | ${setup.length} |`);
line.push(`| Unsettled (never stopped loading) | ${unsettled.length} |`);
line.push(`| Failed to load | ${failed.length} |`);
line.push(`| Not run (needs a seeded record) | ${rows.length - live.length} |`);
line.push("");

line.push("## Defects by class");
line.push("");
line.push("| Class | Rows | Detail |");
line.push("| --- | --- | --- |");
line.push(`| 5xx or uncaught error | ${runtime.length} | ${runtime.slice(0, 8).map((r) => `${r.route}@${r.width}`).join(", ") || "—"} |`);
line.push(`| Never settled | ${unsettled.length} | ${unsettled.slice(0, 8).map((r) => `${r.route}@${r.width}`).join(", ") || "—"} |`);
line.push(`| Horizontal overflow | ${overflow.length} | ${overflow.slice(0, 8).map((r) => `${r.route}@${r.width}`).join(", ") || "—"} |`);
line.push(`| Unnamed control | ${unnamed.length} | ${unnamed.slice(0, 8).map((r) => `${r.route}@${r.width}`).join(", ") || "—"} |`);
line.push(`| Repeated control name | ${duplicated.length} | ${duplicated.slice(0, 8).map((r) => `${r.route}@${r.width}`).join(", ") || "—"} |`);
line.push(`| axe violation | ${axe.length} | ${axe.slice(0, 8).map((r) => `${r.route}: ${(r.axe ?? []).join("; ")}`).join(" / ") || "—"} |`);
line.push(`| Load failure | ${failed.length} | ${failed.slice(0, 8).map((r) => `${r.route}@${r.width} → ${r.destination}`).join(", ") || "—"} |`);
line.push("");

line.push("## Control census (desktop)");
line.push("");
line.push(`Mean buttons per surface: **${meanButtons.toFixed(1)}** · mean controls: ${desktop.length ? (totalControls / desktop.length).toFixed(1) : 0}`);
line.push("");
line.push("| Route | Buttons | Controls |");
line.push("| --- | --- | --- |");
for (const entry of ranked.slice(0, 30)) {
  line.push(`| \`${entry.route}\` | ${entry.buttons} | ${entry.controls} |`);
}
line.push("");

line.push("## Thinnest surfaces");
line.push("");
line.push("A surface under 400 characters of main text is usually a shell, an empty state, or a stub. It is not automatically a defect, but it is a place a user can arrive at and find nothing.");
line.push("");
line.push("| Route | Viewport | Chars |");
line.push("| --- | --- | --- |");
for (const row of thin.slice(0, 30)) line.push(`| \`${row.route}\` | ${row.width} | ${row.textLength} |`);
line.push("");

const out = join(dir, "report.md");
writeFileSync(out, line.join("\n"));
console.log(line.join("\n"));
console.log(`\nWrote ${out}`);
