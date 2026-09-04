import type { PoolClient } from "@neondatabase/serverless";
import {
  canonicalizeFreebuffModel,
  FREEBUFF_UNMETERED_DEFAULT,
  freebuffModelCatalog,
  orgHasAiAccessGrant,
} from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { packForYear } from "@vantage/game-year";
import { headers } from "next/headers";
import {
  canUseDeepGameAnalysis,
  DEEP_GAME_ANALYSIS_TEAM_NUMBER,
  type DeepAnalysisGuessView,
  type DeepAnalysisRunView,
} from "../../../../lib/kickoff/deep-analysis";

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

async function loadOrg(
  client: PoolClient,
  userId: string,
  orgId: string,
): Promise<{ orgId: string; teamNumber: number | null; role: string }> {
  const row = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1 AND m.org_id = $2::uuid
      LIMIT 1`,
    [userId, orgId],
  );
  const membership = row.rows[0];
  if (!membership) throw new HttpError(403, "Organization membership required");
  return membership;
}

function fail(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "Deep analysis request failed" },
    { status: 400 },
  );
}

async function loadView(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
  allowed: boolean,
): Promise<DeepAnalysisRunView> {
  if (!allowed) {
    return {
      allowed: false,
      reason: `Deep game analysis is only available for FRC team ${DEEP_GAME_ANALYSIS_TEAM_NUMBER}.`,
      models: freebuffModelCatalog(),
      run: null,
      sources: [],
      loops: [],
    };
  }

  const run = await client.query<{
    id: string;
    seasonYear: number;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    minHours: number;
    minLoops: number;
    loopCount: number;
    model: string | null;
    latestGuess: DeepAnalysisGuessView | null;
  }>(
    `SELECT id, season_year AS "seasonYear", status, started_at AS "startedAt",
            completed_at AS "completedAt", min_hours AS "minHours", min_loops AS "minLoops",
            loop_count AS "loopCount", latest_guess AS "latestGuess",
            COALESCE(model, $3) AS model
       FROM deep_game_analysis_runs
      WHERE org_id = $1::uuid AND season_year = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, seasonYear, FREEBUFF_UNMETERED_DEFAULT],
  );
  const current = run.rows[0] ?? null;
  if (!current) {
    return { allowed: true, models: freebuffModelCatalog(), run: null, sources: [], loops: [] };
  }

  const [sources, loops] = await Promise.all([
    client.query<{
      url: string;
      title: string;
      kind: string;
      fetchOk: boolean | null;
      excerpt: string;
      error: string | null;
      fetchedAt: Date | null;
    }>(
      `SELECT url, title, kind, fetch_ok AS "fetchOk", excerpt, error, fetched_at AS "fetchedAt"
         FROM deep_game_analysis_sources
        WHERE org_id = $1::uuid AND run_id = $2::uuid
        ORDER BY created_at`,
      [orgId, current.id],
    ),
    client.query<{
      sequence: number;
      status: string;
      startedAt: Date;
      completedAt: Date | null;
      focus: string;
      notes: string;
    }>(
      `SELECT sequence, status, started_at AS "startedAt", completed_at AS "completedAt",
              focus, notes
         FROM deep_game_analysis_loops
        WHERE org_id = $1::uuid AND run_id = $2::uuid
        ORDER BY sequence`,
      [orgId, current.id],
    ),
  ]);

  return {
    allowed: true,
    models: freebuffModelCatalog(),
    run: {
      id: current.id,
      seasonYear: current.seasonYear,
      status: current.status,
      startedAt: current.startedAt?.toISOString() ?? null,
      completedAt: current.completedAt?.toISOString() ?? null,
      minHours: current.minHours,
      minLoops: current.minLoops,
      loopCount: current.loopCount,
      model: current.model,
      latestGuess: current.latestGuess,
    },
    sources: sources.rows.map((source) => ({
      ...source,
      excerpt: source.excerpt.slice(0, 400),
      fetchedAt: source.fetchedAt?.toISOString() ?? null,
    })),
    loops: loops.rows.map((loop) => ({
      ...loop,
      startedAt: loop.startedAt.toISOString(),
      completedAt: loop.completedAt?.toISOString() ?? null,
      notes: loop.notes.slice(0, 400),
    })),
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getUTCFullYear());
    if (!orgId) throw new HttpError(400, "orgId is required");
    if (!Number.isInteger(seasonYear) || seasonYear < 1992 || seasonYear > 2100) {
      throw new HttpError(400, "seasonYear is invalid");
    }

    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const org = await loadOrg(client, session.user.id, orgId);
      try {
        return await loadView(client, org.orgId, seasonYear, canUseDeepGameAnalysis(org.teamNumber));
      } catch (error) {
        if (error instanceof Error && /deep_game_analysis|column \"model\"/.test(error.message)) {
          return {
            allowed: canUseDeepGameAnalysis(org.teamNumber),
            reason: "Apply migrations 0521_deep_game_analysis and 0522_deep_analysis_continuous_models before this panel can load runs.",
            models: freebuffModelCatalog(),
            run: null,
            sources: [],
            loops: [],
          } satisfies DeepAnalysisRunView;
        }
        throw error;
      }
    });
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      action?: string;
      orgId?: string;
      seasonYear?: number;
      model?: string;
    };
    const orgId = body.orgId?.trim();
    const seasonYear = Number(body.seasonYear ?? new Date().getUTCFullYear());
    if (!orgId) throw new HttpError(400, "orgId is required");
    if (!Number.isInteger(seasonYear) || seasonYear < 1992 || seasonYear > 2100) {
      throw new HttpError(400, "seasonYear is invalid");
    }
    const action = body.action === "cancel" ? "cancel" : "start";

    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const org = await loadOrg(client, session.user.id, orgId);
      if (!canUseDeepGameAnalysis(org.teamNumber)) {
        throw new HttpError(
          403,
          `Deep game analysis is only available for FRC team ${DEEP_GAME_ANALYSIS_TEAM_NUMBER}.`,
        );
      }
      if (org.role !== "owner" && org.role !== "admin") {
        throw new HttpError(403, "Owner or admin required to start or stop deep analysis.");
      }

      if (action === "cancel") {
        await client.query(
          `UPDATE deep_game_analysis_runs
              SET status = 'cancelled', completed_at = now(), updated_at = now()
            WHERE org_id = $1::uuid AND season_year = $2 AND status IN ('queued', 'running')`,
          [orgId, seasonYear],
        );
        return loadView(client, orgId, seasonYear, true);
      }

      if (!(await orgHasAiAccessGrant(client, orgId, "platform_relay"))) {
        throw new HttpError(
          400,
          "Platform Free AI (Freebuff / Pi) must be granted before starting a multi-hour analysis.",
        );
      }

      const pack = packForYear(seasonYear);
      const model = canonicalizeFreebuffModel(body.model) ?? FREEBUFF_UNMETERED_DEFAULT;
      let runId: string;
      try {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO deep_game_analysis_runs
             (org_id, season_year, status, started_by, min_hours, min_loops, model)
           VALUES ($1::uuid, $2, 'queued', $3::uuid, 5, 1, $4)
           RETURNING id`,
          [orgId, seasonYear, session.user.id, model],
        );
        runId = inserted.rows[0]?.id ?? "";
      } catch (error) {
        if (error instanceof Error && /deep_game_analysis_runs_active_uq/.test(error.message)) {
          throw new HttpError(409, "A deep analysis run is already in progress for this season.");
        }
        if (error instanceof Error && /deep_game_analysis/.test(error.message)) {
          throw new HttpError(
            400,
            "Apply migrations 0521_deep_game_analysis and 0522_deep_analysis_continuous_models before starting a run.",
          );
        }
        throw error;
      }
      if (!runId) throw new HttpError(409, "A deep analysis run is already in progress for this season.");

      await client.query(
        `INSERT INTO free_relay_jobs (org_id, kind, status, scheduled_for, metadata)
         VALUES ($1::uuid, 'deep_game_analysis', 'queued', now(), $2::jsonb)`,
        [
          orgId,
          JSON.stringify({
            runId,
            seasonYear,
            model,
            packHint: {
              gameName: pack.gameName,
              seasonTheme: pack.seasonTheme,
              status: pack.status,
            },
          }),
        ],
      );
      return loadView(client, orgId, seasonYear, true);
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
