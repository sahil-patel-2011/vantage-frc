import type { PoolClient } from "@neondatabase/serverless";
import { renderFeatureText, renderOutcomeOf, type RenderOutcome } from "../ai-render/render";
import { DECISION_SEARCH_SOURCE_KINDS, searchDocuments, summarizeMatches } from ".";
import type {
  DecisionSearchDocument,
  DecisionSearchMatch,
  DecisionSearchQueryRecord,
  DecisionSearchSourceKind,
} from "./types";

export { DECISION_SEARCH_SOURCE_KINDS };

export type DecisionSearchSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type DecisionSearchView =
  | {
      status: "setup_required";
      message: string;
      steps: DecisionSearchSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      documents: DecisionSearchDocument[];
      recentQueries: DecisionSearchQueryRecord[];
      lastMatches: DecisionSearchMatch[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isSourceKind(value: unknown): value is DecisionSearchSourceKind {
  return typeof value === "string" && (DECISION_SEARCH_SOURCE_KINDS as string[]).includes(value);
}

type DocumentRow = {
  id: string;
  sourceKind: string;
  sourceId: string;
  title: string;
  body: string;
  seasonYear: number;
  tags: string[] | null;
  createdAt: string;
};

function mapDocument(row: DocumentRow): DecisionSearchDocument {
  return {
    id: row.id,
    sourceKind: isSourceKind(row.sourceKind) ? row.sourceKind : "notebook_entry",
    sourceId: row.sourceId,
    title: row.title,
    body: row.body,
    seasonYear: row.seasonYear,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.createdAt,
  };
}

type QueryRow = {
  id: string;
  queryText: string;
  resultDocumentIds: string[] | null;
  resultSummary: string | null;
  seasonYear: number;
  createdAt: string;
};

function mapQuery(row: QueryRow): DecisionSearchQueryRecord {
  return {
    id: row.id,
    queryText: row.queryText,
    resultDocumentIds: Array.isArray(row.resultDocumentIds) ? row.resultDocumentIds : [],
    resultSummary: row.resultSummary,
    seasonYear: row.seasonYear,
    createdAt: row.createdAt,
  };
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

export async function computeDecisionSearchView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<DecisionSearchView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to search decisions, design reviews, and notebook entries.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [documentResult, seasonResult, queryResult] = await Promise.all([
    client.query<DocumentRow>(
      `SELECT id, source_kind AS "sourceKind", source_id AS "sourceId", title, body,
              season_year AS "seasonYear", tags, created_at AS "createdAt"
       FROM decision_search_documents
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM decision_search_documents WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    client.query<QueryRow>(
      `SELECT id, query_text AS "queryText", result_document_ids AS "resultDocumentIds",
              result_summary AS "resultSummary", season_year AS "seasonYear", created_at AS "createdAt"
       FROM decision_search_queries
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [org.orgId, seasonYear],
    ),
  ]);

  const documents = documentResult.rows.map(mapDocument);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);
  const recentQueries = queryResult.rows.map(mapQuery);

  const lastQuery = recentQueries[0];
  const lastMatches = lastQuery ? searchDocuments(lastQuery.queryText, documents) : [];

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    documents,
    recentQueries,
    lastMatches,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function indexDocument(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sourceKind: DecisionSearchSourceKind;
    sourceId: string;
    title: string;
    body: string;
    seasonYear: number;
    tags: string[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO decision_search_documents (
       org_id, source_kind, source_id, title, body, season_year, tags, indexed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8)
     ON CONFLICT (org_id, source_kind, source_id) DO UPDATE
       SET title = EXCLUDED.title, body = EXCLUDED.body, season_year = EXCLUDED.season_year, tags = EXCLUDED.tags`,
    [input.orgId, input.sourceKind, input.sourceId, input.title, input.body, input.seasonYear, input.tags, input.userId],
  );
}

export async function deleteDocument(
  client: PoolClient,
  input: { orgId: string; documentId: string },
): Promise<void> {
  await client.query(`DELETE FROM decision_search_documents WHERE id = $1 AND org_id = $2`, [
    input.documentId,
    input.orgId,
  ]);
}

type DecisionRecordRow = {
  id: string;
  title: string;
  category: string;
  status: string;
  context: string | null;
  decision: string | null;
  rationale: string | null;
};

/**
 * Grounded import: pull the org's existing Decision Log (decision_records) for a season into the
 * search index. Body text is assembled only from the record's real context/decision/rationale —
 * nothing is fabricated. Idempotent via the (org_id, source_kind, source_id) upsert in indexDocument.
 * Returns the number of decision records indexed.
 */
export async function importDecisionRecords(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number },
): Promise<number> {
  const result = await client.query<DecisionRecordRow>(
    `SELECT id, title, category, status, context, decision, rationale
     FROM decision_records
     WHERE org_id = $1 AND season_year = $2`,
    [input.orgId, input.seasonYear],
  );

  for (const row of result.rows) {
    const body = [
      row.context ? `Context: ${row.context}` : null,
      row.decision ? `Decision: ${row.decision}` : null,
      row.rationale ? `Rationale: ${row.rationale}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    const tags = Array.from(new Set([row.category, row.status].filter((tag): tag is string => Boolean(tag))));
    await indexDocument(client, {
      orgId: input.orgId,
      userId: input.userId,
      sourceKind: "decision",
      sourceId: row.id,
      title: row.title,
      body: body || row.title,
      seasonYear: input.seasonYear,
      tags,
    });
  }

  return result.rows.length;
}

/** Runs a metered semantic search over the org's indexed documents and logs the query + results. */
export async function runSearch(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; queryText: string },
): Promise<{ matches: DecisionSearchMatch[]; summary: string; render: RenderOutcome }> {
  const documentResult = await client.query<DocumentRow>(
    `SELECT id, source_kind AS "sourceKind", source_id AS "sourceId", title, body,
            season_year AS "seasonYear", tags, created_at AS "createdAt"
     FROM decision_search_documents
     WHERE org_id = $1 AND season_year = $2
     ORDER BY created_at DESC`,
    [input.orgId, input.seasonYear],
  );
  const documents = documentResult.rows.map(mapDocument);

  const matches = searchDocuments(input.queryText, documents);
  // The match set is deterministic term-overlap search; a real model call on the org's
  // adapter writes the summary of what matched, with the template standing in on failure.
  const rendered = await renderFeatureText({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "decision_search",
    prompt: [
      `A team member searched their logged decisions, design reviews and notebook entries for "${input.queryText}" (${input.seasonYear} season).`,
      `Matches (${matches.length}), best first:`,
      ...matches.slice(0, 8).map((match) => `- ${match.document.title} [${match.document.sourceKind}]`),
      "Write a 1-2 sentence summary in the template's structure: how many matched and which top titles are most relevant. Name only titles listed above; invent nothing.",
    ].join("\n"),
    template: () => summarizeMatches(input.queryText, matches),
    metadata: { seasonYear: input.seasonYear, documentCount: documents.length, matchCount: matches.length },
  });
  const result = { matches, summary: rendered.text, render: renderOutcomeOf(rendered) };

  await client.query(
    `INSERT INTO decision_search_queries (
       org_id, season_year, query_text, result_document_ids, result_summary, searched_by
     ) VALUES ($1,$2,$3,$4::uuid[],$5,$6)`,
    [
      input.orgId,
      input.seasonYear,
      input.queryText,
      result.matches.slice(0, 20).map((m) => m.document.id),
      result.summary,
      input.userId,
    ],
  );

  return result;
}
