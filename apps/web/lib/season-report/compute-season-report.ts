import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import {
  buildSeasonReportNarrative,
  extractHighlights,
  extractWatchouts,
  summarizeSeasonReportEntries,
} from ".";
import type {
  SeasonReportCategory,
  SeasonReportEntry,
  SeasonReportSentiment,
  SeasonReportSnapshot,
  SeasonReportSummary,
} from "./types";

export type SeasonReportSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SeasonReportView =
  | {
      status: "setup_required";
      message: string;
      steps: SeasonReportSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      entries: SeasonReportEntry[];
      summary: SeasonReportSummary;
      snapshots: SeasonReportSnapshot[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

type EntryRow = {
  id: string;
  seasonYear: number;
  category: SeasonReportCategory;
  title: string;
  detail: string | null;
  metricLabel: string | null;
  metricValue: string | null;
  sentiment: SeasonReportSentiment;
  createdAt: string;
};

function mapEntry(row: EntryRow): SeasonReportEntry {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    category: row.category,
    title: row.title,
    detail: row.detail,
    metricLabel: row.metricLabel,
    metricValue: row.metricValue != null ? Number(row.metricValue) || 0 : null,
    sentiment: row.sentiment,
    createdAt: row.createdAt,
  };
}

type SnapshotRow = {
  id: string;
  seasonYear: number;
  completeness: string;
  narrative: SeasonReportSnapshot["narrative"];
  highlights: string[] | null;
  watchouts: string[] | null;
  entryCount: number;
  createdAt: string;
};

function mapSnapshot(row: SnapshotRow): SeasonReportSnapshot {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    completeness: Number(row.completeness) || 0,
    narrative: row.narrative,
    highlights: Array.isArray(row.highlights) ? row.highlights : [],
    watchouts: Array.isArray(row.watchouts) ? row.watchouts : [],
    entryCount: Number(row.entryCount) || 0,
    createdAt: row.createdAt,
  };
}

export async function loadEntries(client: PoolClient, orgId: string, seasonYear: number): Promise<SeasonReportEntry[]> {
  const result = await client.query<EntryRow>(
    `SELECT id, season_year AS "seasonYear", category, title, detail,
            metric_label AS "metricLabel", metric_value::text AS "metricValue",
            sentiment, created_at AS "createdAt"
     FROM season_report_entries
     WHERE org_id = $1 AND season_year = $2
     ORDER BY created_at DESC`,
    [orgId, seasonYear],
  );
  return result.rows.map(mapEntry);
}

export async function computeSeasonReportView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<SeasonReportView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build your season retrospective.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [entries, seasonResult, snapshotResult] = await Promise.all([
    loadEntries(client, org.orgId, seasonYear),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM season_report_entries WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    client.query<SnapshotRow>(
      `SELECT id, season_year AS "seasonYear", completeness::text AS completeness, narrative,
              highlights, watchouts, entry_count AS "entryCount", created_at AS "createdAt"
       FROM season_report_snapshots
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 10`,
      [org.orgId, seasonYear],
    ),
  ]);

  const summary = summarizeSeasonReportEntries(entries);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    entries,
    summary,
    snapshots: snapshotResult.rows.map(mapSnapshot),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    category: SeasonReportCategory;
    title: string;
    detail: string | null;
    metricLabel: string | null;
    metricValue: number | null;
    sentiment: SeasonReportSentiment;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO season_report_entries (
       org_id, season_year, category, title, detail, metric_label, metric_value, sentiment, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.seasonYear,
      input.category,
      input.title,
      input.detail,
      input.metricLabel,
      input.metricValue,
      input.sentiment,
      input.userId,
    ],
  );
}

export async function deleteEntry(client: PoolClient, input: { orgId: string; entryId: string }): Promise<void> {
  await client.query(`DELETE FROM season_report_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}

/**
 * Generate a season retrospective snapshot from logged entries and persist it. The narrative
 * synthesis is fully deterministic (buildSeasonReportNarrative) so meteredAI wraps it purely to
 * route the run through the standard usage-ledger path, matching every other metered feature.
 */
export async function generateSnapshot(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number },
): Promise<SeasonReportSnapshot> {
  const entries = await loadEntries(client, input.orgId, input.seasonYear);
  const summary = summarizeSeasonReportEntries(entries);

  const result = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "season_report",
    requestId: `season-report-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      seasonYear: input.seasonYear,
      entryCount: entries.length,
      completeness: summary.completeness,
      note: "Deterministic narrative synthesis from logged entries — no external model call",
    },
    invoke: async () => {
      const narrative = buildSeasonReportNarrative(entries);
      const highlights = extractHighlights(entries);
      const watchouts = extractWatchouts(entries);
      return {
        value: { narrative, highlights, watchouts },
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "vantage-season-report-v1",
        provider: "vantage-local",
      };
    },
  });

  const { narrative, highlights, watchouts } = result;

  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO season_report_snapshots (
       org_id, season_year, completeness, narrative, highlights, watchouts, entry_count, created_by
     ) VALUES ($1,$2,$3,$4::jsonb,$5::text[],$6::text[],$7,$8)
     RETURNING id, created_at AS "createdAt"`,
    [
      input.orgId,
      input.seasonYear,
      summary.completeness,
      JSON.stringify(narrative),
      highlights,
      watchouts,
      entries.length,
      input.userId,
    ],
  );

  return {
    id: inserted.rows[0]!.id,
    seasonYear: input.seasonYear,
    completeness: summary.completeness,
    narrative,
    highlights,
    watchouts,
    entryCount: entries.length,
    createdAt: inserted.rows[0]!.createdAt,
  };
}

export async function deleteSnapshot(
  client: PoolClient,
  input: { orgId: string; snapshotId: string },
): Promise<void> {
  await client.query(`DELETE FROM season_report_snapshots WHERE id = $1 AND org_id = $2`, [
    input.snapshotId,
    input.orgId,
  ]);
}
