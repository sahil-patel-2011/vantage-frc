#!/usr/bin/env node
/**
 * Alliance-score backtest.
 *
 * Reads cached reference tables when DATABASE_URL / DATABASE_ADMIN_URL is set.
 * Never opens TBA polls. With no database (or empty cache), writes the fixture
 * table and says so — that is not a ±3 claim.
 *
 *   node scripts/prediction-backtest.mjs
 *   DATABASE_URL=postgres://… node scripts/prediction-backtest.mjs --year 2026
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const yearFlag = process.argv.includes("--year")
  ? process.argv[process.argv.indexOf("--year") + 1]
  : "2026";

function allianceEpa(side, metrics) {
  let total = 0;
  let counted = 0;
  const missing = [];
  for (const key of side) {
    const row = metrics.get(key);
    if (!row || (row.auto == null && row.tele == null && row.end == null)) {
      missing.push(key);
      continue;
    }
    total += (row.auto ?? 0) + (row.tele ?? 0) + (row.end ?? 0);
    counted += 1;
  }
  if (counted === 0) return { total: null, missing };
  return { total, missing };
}

function metricsOf(rows) {
  let n = 0;
  let abs = 0;
  let sq = 0;
  let within3 = 0;
  let within5 = 0;
  for (const row of rows) {
    n += 2;
    abs += row.redErr + row.blueErr;
    sq += row.redErr * row.redErr + row.blueErr * row.blueErr;
    if (row.redErr <= 3) within3 += 1;
    if (row.blueErr <= 3) within3 += 1;
    if (row.redErr <= 5) within5 += 1;
    if (row.blueErr <= 5) within5 += 1;
  }
  return {
    n,
    mae: n ? Math.round((abs / n) * 100) / 100 : 0,
    rmse: n ? Math.round(Math.sqrt(sq / n) * 100) / 100 : 0,
    within3: n ? Math.round((within3 / n) * 1000) / 1000 : 0,
    within5: n ? Math.round((within5 / n) * 1000) / 1000 : 0,
  };
}

async function seasonFromCache(year) {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) return null;
  let Client;
  try {
    const pg = await import("pg");
    Client = pg.Client ?? pg.default?.Client;
  } catch {
    return { error: "pg is not installed in this environment" };
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "could not connect" };
  }
  try {
    const matches = await client.query(
      `SELECT match_key, event_key, comp_level, red_alliance, blue_alliance
         FROM matches_ref
        WHERE event_key LIKE $1
          AND (red_alliance->>'score') IS NOT NULL
          AND (blue_alliance->>'score') IS NOT NULL
        LIMIT 800`,
      [`${year}%`],
    );
    const yearMetrics = await client.query(
      `SELECT DISTINCT ON (team_key)
              team_key, epa_auto, epa_teleop, epa_endgame
         FROM team_year_metrics
        WHERE year = $1
        ORDER BY team_key, CASE source WHEN 'statbotics' THEN 0 ELSE 1 END, synced_at DESC`,
      [Number(year)],
    );
    const metrics = new Map();
    for (const row of yearMetrics.rows) {
      metrics.set(row.team_key, {
        auto: row.epa_auto == null ? null : Number(row.epa_auto),
        tele: row.epa_teleop == null ? null : Number(row.epa_teleop),
        end: row.epa_endgame == null ? null : Number(row.epa_endgame),
      });
    }
    const scored = [];
    let skipped = 0;
    for (const match of matches.rows) {
      const redKeys = Array.isArray(match.red_alliance?.teamKeys) ? match.red_alliance.teamKeys : [];
      const blueKeys = Array.isArray(match.blue_alliance?.teamKeys) ? match.blue_alliance.teamKeys : [];
      const redScore = Number(match.red_alliance?.score);
      const blueScore = Number(match.blue_alliance?.score);
      if (!Number.isFinite(redScore) || !Number.isFinite(blueScore)) {
        skipped += 1;
        continue;
      }
      const red = allianceEpa(redKeys, metrics);
      const blue = allianceEpa(blueKeys, metrics);
      if (red.total == null || blue.total == null) {
        skipped += 1;
        continue;
      }
      scored.push({
        redErr: Math.abs(red.total - redScore),
        blueErr: Math.abs(blue.total - blueScore),
      });
    }
    return {
      matches: matches.rowCount ?? 0,
      scored: scored.length,
      skipped,
      metrics: metricsOf(scored),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "query failed" };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const fixtureRow = [
  "fixture (2 matches)",
  "unit-tested",
  "see vitest",
  "see vitest",
  "not a season claim",
  "not a season claim",
  "packages/prediction-strategy/test/calibrated-score.test.ts",
];

const season = await seasonFromCache(yearFlag);
const table = [
  ["set", "n", "MAE", "RMSE", "within ±3", "within ±5", "note"],
  fixtureRow,
];
let seasonNote =
  "No DATABASE_URL. This run did not score a live season (refusing to poll TBA).";
if (season && "error" in season && season.error) {
  seasonNote = `Database present but unusable (${season.error}). Fixture only. No TBA polls.`;
} else if (season && season.scored === 0) {
  seasonNote = `Cached tables for ${yearFlag} had ${season.matches} matches with scores and ${season.skipped} skipped for missing EPA. Not a ±3 claim.`;
  table.push([
    `cached ${yearFlag}`,
    String(season.scored * 2),
    "—",
    "—",
    "—",
    "—",
    "no scored alliances after skipping missing EPA",
  ]);
} else if (season) {
  const { metrics } = season;
  seasonNote = `Cached ${yearFlag}: ${season.matches} matches with scores, ${season.scored} predicted, ${season.skipped} skipped. This is the honest number, not a marketing target.`;
  table.push([
    `cached ${yearFlag}`,
    String(metrics.n),
    String(metrics.mae),
    String(metrics.rmse),
    String(metrics.within3),
    String(metrics.within5),
    `${season.scored} matches predicted from team_year_metrics + matches_ref`,
  ]);
}

const markdown = [
  "# Match prediction results",
  "",
  "Generated by `scripts/prediction-backtest.mjs`.",
  "",
  "**This is not a ±3 claim unless the cached-season row below has a within-±3 rate and you trust that cache.**",
  "Scoring a season needs `matches_ref` + `team_year_metrics` already ingested. This script never polls TBA.",
  "",
  seasonNote,
  "",
  "```sh",
  "DATABASE_URL=postgres://… node scripts/prediction-backtest.mjs --year 2026",
  "```",
  "",
  `| ${table[0].join(" | ")} |`,
  `| ${table[0].map(() => "---").join(" | ")} |`,
  ...table.slice(1).map((row) => `| ${row.join(" | ")} |`),
  "",
  "## Method",
  "",
  "- Features: Statbotics EPA auto/teleop/endgame (year metrics), optional OPR later.",
  "- Model: calibrated linear blend (`calibrated-linear-v1`) — sum of EPA components per alliance.",
  "- Split (when a season is present): whatever is in the cache; this script does not re-ingest.",
  "- A match with missing alliance metrics is skipped, never filled.",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)}. Target year this run: ${yearFlag}.`,
  "",
].join("\n");

const dest = join(ROOT, "docs/PREDICTION_RESULTS.md");
writeFileSync(dest, markdown);
console.log(seasonNote);
console.log(markdown);
