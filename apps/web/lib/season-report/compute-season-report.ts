import type { PoolClient } from "@neondatabase/serverless";
import { renderFeatureValue, type RenderOutcome } from "../ai-render/render";
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
      /** Set on the POST that generated the newest snapshot: model vs template (renderWithModel). */
      render?: RenderOutcome;
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
 * synthesis starts deterministic (buildSeasonReportNarrative); renderWithModel then asks the org's real model to write the paragraphs (template fallback), and the call goes through meteredAI to
 * route the run through the standard usage-ledger path, matching every other metered feature.
 */
export async function generateSnapshot(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number },
): Promise<SeasonReportSnapshot & { render: RenderOutcome }> {
  const entries = await loadEntries(client, input.orgId, input.seasonYear);
  const summary = summarizeSeasonReportEntries(entries);

  const highlights = extractHighlights(entries);
  const watchouts = extractWatchouts(entries);
  // Real model call on the org's adapter with the deterministic narrative as fallback: the
  // five section paragraphs may be rewritten; highlights, watchouts and completeness are
  // computed from the logged entries and are the only facts the model may use.
  const {
    value: { narrative },
    render,
  } = await renderFeatureValue({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "season_report",
    value: { narrative: buildSeasonReportNarrative(entries) },
    editableKeys: ["buildReliability", "results", "budget", "outreach", "lessons"],
    instructions: `Season retrospective for the ${input.seasonYear} FRC season, computed from ${entries.length} logged entr${entries.length === 1 ? "y" : "ies"}. Rewrite each section as one cohesive paragraph for mentors, students and sponsors; when a section says nothing was logged, keep saying so plainly.`,
    facts: [
      highlights.length ? `Highlights (logged as positive):\n${highlights.map((item) => `- ${item}`).join("\n")}` : "Highlights: none logged.",
      watchouts.length ? `Watchouts (logged as needing attention):\n${watchouts.map((item) => `- ${item}`).join("\n")}` : "Watchouts: none logged.",
    ].join("\n"),
    maxTokens: 900,
    metadata: { seasonYear: input.seasonYear, entryCount: entries.length, completeness: summary.completeness },
  });

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
    render,
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
