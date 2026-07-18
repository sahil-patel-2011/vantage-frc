import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { AIOrchestrator, type ChatAdapter, type ContextSource } from "@vantage/agent";
import { CadRepository } from "@vantage/cad";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildCadBriefFromIntelligence,
  buildStrategyFromIntelligence,
  excerpt,
  KICKOFF_ADVICE_LABEL,
  KICKOFF_INTELLIGENCE_MODEL,
  parseKickoffIntelligenceAction,
  sourceChecksum,
  structureGameIntelligence,
  type DesignDirection,
  type GameIntelligenceSummary,
  type KickoffIntelligenceRecord,
  type StrategyAdviceBundle,
} from "../../../../lib/kickoff-intelligence";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "Kickoff intelligence request failed" },
    { status },
  );
}

function localIntelligenceAdapter(summary: GameIntelligenceSummary, strategy: StrategyAdviceBundle): ChatAdapter {
  const text = JSON.stringify({ summary, strategyAdvice: strategy, adviceLabel: KICKOFF_ADVICE_LABEL });
  return {
    provider: "local",
    model: KICKOFF_INTELLIGENCE_MODEL,
    complete: async () => ({
      text,
      promptTokens: Math.ceil(strategy.message.length / 4) + Math.ceil(summary.overview.length / 4),
      completionTokens: Math.ceil(text.length / 4),
      costUsd: 0,
    }),
  };
}

async function fetchUrlText(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "Source URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "Source URL must be http or https");
  }
  const response = await fetch(parsed, {
    headers: { accept: "text/plain,text/markdown,text/html,application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new HttpError(400, `Could not fetch source URL (HTTP ${response.status})`);
  const contentType = response.headers.get("content-type") ?? "";
  if (/pdf|octet-stream|image\//i.test(contentType)) {
    throw new HttpError(
      400,
      "PDF/binary URLs are not extracted automatically — paste the manual text or a transcript instead.",
    );
  }
  const text = await response.text();
  return excerpt(text, 100_000);
}

type IntelligenceRow = {
  id: string;
  seasonYear: number;
  status: KickoffIntelligenceRecord["status"];
  title: string;
  summary: GameIntelligenceSummary;
  strategyAdvice: StrategyAdviceBundle;
  designPrioritiesDraft: DesignDirection[];
  cadBriefRequest: string;
  cadJobId: string | null;
  aiRunId: string | null;
  provider: string;
  model: string;
  sourceUrl: string | null;
  sourceChecksum: string;
  adviceLabel: typeof KICKOFF_ADVICE_LABEL;
  createdAt: string;
  appliedAt: string | null;
};

function mapRow(row: IntelligenceRow): KickoffIntelligenceRecord {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    status: row.status,
    title: row.title,
    summary: row.summary,
    strategyAdvice: row.strategyAdvice,
    designPrioritiesDraft: row.designPrioritiesDraft,
    cadBriefRequest: row.cadBriefRequest,
    cadJobId: row.cadJobId,
    aiRunId: row.aiRunId,
    provider: row.provider,
    model: row.model,
    sourceUrl: row.sourceUrl,
    sourceChecksum: row.sourceChecksum,
    adviceLabel: row.adviceLabel,
    createdAt: row.createdAt,
    appliedAt: row.appliedAt,
  };
}

async function loadRecords(client: PoolClient, orgId: string, seasonYear?: number | null) {
  const result = await client.query<IntelligenceRow>(
    `SELECT id, season_year AS "seasonYear", status, title,
            summary, strategy_advice AS "strategyAdvice",
            design_priorities_draft AS "designPrioritiesDraft",
            cad_brief_request AS "cadBriefRequest",
            cad_job_id AS "cadJobId", ai_run_id AS "aiRunId",
            provider, model, source_url AS "sourceUrl",
            source_checksum AS "sourceChecksum",
            advice_label AS "adviceLabel",
            created_at::text AS "createdAt",
            applied_at::text AS "appliedAt"
     FROM kickoff_game_intelligence
     WHERE org_id = $1 AND ($2::int IS NULL OR season_year = $2::int)
     ORDER BY season_year DESC, created_at DESC
     LIMIT 40`,
    [orgId, seasonYear ?? null],
  );
  return result.rows.map(mapRow);
}

async function loadPriorCapabilities(client: PoolClient, orgId: string, seasonYear: number) {
  const result = await client.query<{ capability: string }>(
    `SELECT capability FROM design_priorities
     WHERE org_id = $1 AND season_year < $2 AND status <> 'cut'
     ORDER BY season_year DESC, weight DESC
     LIMIT 24`,
    [orgId, seasonYear],
  );
  return result.rows.map((row) => row.capability);
}

async function applyDraftsToWorkspace(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    summary: GameIntelligenceSummary;
    directions: DesignDirection[];
  },
) {
  const insertedActions: string[] = [];
  for (const [index, row] of input.summary.scoring.entries()) {
    if (row.points == null) continue;
    const existing = await client.query(
      `SELECT 1 FROM game_scoring_actions
       WHERE org_id = $1 AND season_year = $2 AND lower(label) = lower($3) LIMIT 1`,
      [input.orgId, input.seasonYear, row.action],
    );
    if (existing.rowCount) continue;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO game_scoring_actions
         (org_id, season_year, label, phase, points, est_seconds, notes, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8) RETURNING id`,
      [
        input.orgId,
        input.seasonYear,
        row.action.slice(0, 160),
        row.phase,
        row.points,
        row.notes.slice(0, 2000),
        index,
        input.userId,
      ],
    );
    insertedActions.push(inserted.rows[0]!.id);
  }

  const insertedPriorities: string[] = [];
  for (const direction of input.directions) {
    const existing = await client.query(
      `SELECT 1 FROM design_priorities
       WHERE org_id = $1 AND season_year = $2 AND lower(capability) = lower($3) LIMIT 1`,
      [input.orgId, input.seasonYear, direction.capability],
    );
    if (existing.rowCount) continue;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO design_priorities
         (org_id, season_year, capability, rationale, weight, linked_action_id, created_by)
       VALUES ($1, $2, $3, $4, $5, NULL, $6) RETURNING id`,
      [
        input.orgId,
        input.seasonYear,
        direction.capability.slice(0, 160),
        `${direction.rationale} [${KICKOFF_ADVICE_LABEL}]`.slice(0, 2000),
        direction.weight,
        input.userId,
      ],
    );
    insertedPriorities.push(inserted.rows[0]!.id);
  }

  const insertedNotes: string[] = [];
  for (const question of input.summary.openQuestions) {
    const existing = await client.query(
      `SELECT 1 FROM kickoff_rule_notes
       WHERE org_id = $1 AND season_year = $2 AND lower(question) = lower($3) LIMIT 1`,
      [input.orgId, input.seasonYear, question],
    );
    if (existing.rowCount) continue;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO kickoff_rule_notes (org_id, season_year, question, rule_ref, created_by)
       VALUES ($1, $2, $3, '', $4) RETURNING id`,
      [input.orgId, input.seasonYear, question.slice(0, 500), input.userId],
    );
    insertedNotes.push(inserted.rows[0]!.id);
  }

  return {
    scoringActions: insertedActions.length,
    priorities: insertedPriorities.length,
    ruleNotes: insertedNotes.length,
  };
}

async function createCadBriefFor(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    summary: GameIntelligenceSummary;
    strategy: StrategyAdviceBundle;
    intelligenceId: string;
  },
) {
  const seed = buildCadBriefFromIntelligence({
    summary: input.summary,
    strategy: input.strategy,
    intelligenceId: input.intelligenceId,
  });
  const repository = new CadRepository(client);
  const sources: ContextSource[] = seed.sources.map((source) => ({
    type: source.type,
    id: source.id,
    content: source.content,
    importance: source.importance,
    classification: source.classification,
  }));
  const created = await repository.createBriefJob({
    orgId: input.orgId,
    userId: input.userId,
    requestId: randomUUID(),
    title: seed.title,
    request: seed.request,
    sources,
    platform: "mock",
    executionMode: "hosted",
  });
  return { cadJobId: created.jobId, aiRunId: created.aiRunId, request: seed.request };
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const seasonYearParam = url.searchParams.get("seasonYear");
    const seasonYear = seasonYearParam ? Number(seasonYearParam) : null;
    if (!orgId) throw new HttpError(400, "Organization is required");
    if (seasonYearParam && (!Number.isInteger(seasonYear) || (seasonYear ?? 0) < 1992)) {
      throw new HttpError(400, "Season year is invalid");
    }

    const payload = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMembership(client, orgId, session.user.id);
      const records = await loadRecords(client, orgId, seasonYear);
      return {
        status: records.length ? ("ready" as const) : ("empty" as const),
        message: records.length
          ? null
          : "Upload a game manual excerpt or kickoff transcript to generate the season intelligence summary.",
        records,
      };
    });

    return Response.json(payload);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseKickoffIntelligenceAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "analyze": {
          let manualText = action.manualText ?? "";
          const transcriptText = action.transcriptText ?? "";
          if (action.sourceUrl && !manualText) {
            manualText = await fetchUrlText(action.sourceUrl);
          }

          const ingest = {
            seasonYear: action.seasonYear,
            manualText,
            transcriptText,
            sourceUrl: action.sourceUrl,
          };
          const summary = structureGameIntelligence(ingest);
          const priorCapabilities = await loadPriorCapabilities(client, action.orgId, action.seasonYear);
          const strategy = buildStrategyFromIntelligence({ summary, priorCapabilities });
          const cadSeed = buildCadBriefFromIntelligence({ summary, strategy });

          const contextSources = (
            [
              {
                type: "module_data" as const,
                id: `kickoff-manual:${action.seasonYear}`,
                content: excerpt(manualText, 6_000),
                importance: 1,
                classification: "researched_claim" as const,
              },
              {
                type: "module_data" as const,
                id: `kickoff-transcript:${action.seasonYear}`,
                content: excerpt(transcriptText, 6_000),
                importance: 0.95,
                classification: "researched_claim" as const,
              },
            ] satisfies ContextSource[]
          ).filter((source) => source.content.trim());

          const orchestrated = await new AIOrchestrator(client).run({
            orgId: action.orgId,
            userId,
            requestId: randomUUID(),
            capability: "strategy",
            privacyScope: "team",
            message: strategy.message,
            adapter: localIntelligenceAdapter(summary, strategy),
            contextSources,
          });

          const artifact = await new AIOrchestrator(client).createArtifact({
            runId: orchestrated.runId,
            orgId: action.orgId,
            userId,
            kind: "kickoff_game_intelligence",
            title: summary.gameName
              ? `${summary.seasonYear} ${summary.gameName} intelligence`
              : `${summary.seasonYear} kickoff intelligence`,
            content: {
              summary,
              strategyAdvice: strategy,
              adviceLabel: KICKOFF_ADVICE_LABEL,
            },
            claims: [
              {
                claim: "Structured from uploaded kickoff release materials",
                classification: "researched_claim",
                sourceIds: contextSources.map((source) => source.id),
              },
              {
                claim: "Design directions are MODEL advice, not DEMO match statistics",
                classification: "model_inference",
                sourceIds: [`kickoff-strategy:${action.seasonYear}`],
              },
            ],
          });

          const title = summary.gameName
            ? `${summary.seasonYear} ${summary.gameName}`
            : `${summary.seasonYear} game release summary`;

          const inserted = await client.query<{ id: string }>(
            `INSERT INTO kickoff_game_intelligence (
               org_id, season_year, status, title, summary, strategy_advice,
               design_priorities_draft, cad_brief_request, ai_run_id, ai_artifact_id,
               provider, model, source_manual_excerpt, source_transcript_excerpt,
               source_url, source_checksum, advice_label, created_by
             ) VALUES (
               $1, $2, 'ready', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7,
               $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
             ) RETURNING id`,
            [
              action.orgId,
              action.seasonYear,
              title,
              JSON.stringify(summary),
              JSON.stringify(strategy),
              JSON.stringify(strategy.designPriorities),
              cadSeed.request,
              orchestrated.runId,
              artifact.id,
              orchestrated.provider,
              orchestrated.model,
              excerpt(manualText),
              excerpt(transcriptText),
              action.sourceUrl,
              sourceChecksum(ingest),
              KICKOFF_ADVICE_LABEL,
              userId,
            ],
          );
          const intelligenceId = inserted.rows[0]!.id;

          let applied: { scoringActions: number; priorities: number; ruleNotes: number } | null = null;
          if (action.applyDrafts) {
            applied = await applyDraftsToWorkspace(client, {
              orgId: action.orgId,
              userId,
              seasonYear: action.seasonYear,
              summary,
              directions: strategy.designPriorities,
            });
            await client.query(
              `UPDATE kickoff_game_intelligence
               SET status = 'applied', applied_at = now(), updated_at = now()
               WHERE id = $1 AND org_id = $2`,
              [intelligenceId, action.orgId],
            );
          }

          let cadJobId: string | null = null;
          if (action.createCadBrief) {
            const cad = await createCadBriefFor(client, {
              orgId: action.orgId,
              userId,
              summary,
              strategy,
              intelligenceId,
            });
            cadJobId = cad.cadJobId;
            await client.query(
              `UPDATE kickoff_game_intelligence
               SET cad_job_id = $3, cad_brief_request = $4, updated_at = now()
               WHERE id = $1 AND org_id = $2`,
              [intelligenceId, action.orgId, cad.cadJobId, cad.request],
            );
          }

          const [record] = await loadRecords(client, action.orgId, action.seasonYear);
          return {
            ok: true,
            id: intelligenceId,
            adviceLabel: KICKOFF_ADVICE_LABEL,
            applied,
            cadJobId,
            record: record ?? null,
            summary,
            strategyAdvice: strategy,
          };
        }

        case "apply": {
          const row = await client.query<{
            seasonYear: number;
            summary: GameIntelligenceSummary;
            designPrioritiesDraft: DesignDirection[];
          }>(
            `SELECT season_year AS "seasonYear", summary,
                    design_priorities_draft AS "designPrioritiesDraft"
             FROM kickoff_game_intelligence WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId],
          );
          const current = row.rows[0];
          if (!current) throw new HttpError(404, "Intelligence record not found");
          const applied = await applyDraftsToWorkspace(client, {
            orgId: action.orgId,
            userId,
            seasonYear: current.seasonYear,
            summary: current.summary,
            directions: current.designPrioritiesDraft,
          });
          await client.query(
            `UPDATE kickoff_game_intelligence
             SET status = 'applied', applied_at = now(), updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId],
          );
          return { ok: true, applied };
        }

        case "create_cad_brief": {
          const row = await client.query<{
            summary: GameIntelligenceSummary;
            strategyAdvice: StrategyAdviceBundle;
          }>(
            `SELECT summary, strategy_advice AS "strategyAdvice"
             FROM kickoff_game_intelligence WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId],
          );
          const current = row.rows[0];
          if (!current) throw new HttpError(404, "Intelligence record not found");
          const cad = await createCadBriefFor(client, {
            orgId: action.orgId,
            userId,
            summary: current.summary,
            strategy: current.strategyAdvice,
            intelligenceId: action.id,
          });
          await client.query(
            `UPDATE kickoff_game_intelligence
             SET cad_job_id = $3, cad_brief_request = $4, updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId, cad.cadJobId, cad.request],
          );
          return { ok: true, cadJobId: cad.cadJobId };
        }

        case "delete": {
          const deleted = await client.query(`DELETE FROM kickoff_game_intelligence WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Intelligence record not found");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported kickoff intelligence action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
