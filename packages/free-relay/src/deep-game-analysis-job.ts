import type { PoolClient } from "@neondatabase/serverless";
import type { ChatAdapter } from "@vantage/agent";
import { safeAllowlistedFetch } from "@vantage/agent";
import { randomUUID } from "node:crypto";
import {
  ANALYSIS_TURN_FOCUSES,
  buildLoopTurnPrompt,
  DEEP_GAME_ANALYSIS_FEATURE,
  DEEP_GAME_ANALYSIS_KIND,
  DEEP_GAME_ANALYSIS_TEAM_NUMBER,
  emptyGuess,
  isDeepGameAnalysisTeam,
  loopStillOpen,
  parseDeepGameGuess,
  readDeepAnalysisPacing,
  seedSourcesForSeason,
  shouldContinueDeepAnalysis,
  type DeepAnalysisClock,
  type DeepGameGuess,
  type DeepGameTurn,
} from "./deep-game-analysis";

export type DeepGameAnalysisJobResult = {
  runId: string;
  loopSequence: number;
  continued: boolean;
  skipped?: boolean;
  reason?: string;
  guess: DeepGameGuess;
};

const defaultClock = (): DeepAnalysisClock => ({
  now: () => new Date(),
  sleep: (ms) => (ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))),
});

export async function assertDeepAnalysisOrg(
  client: PoolClient,
  orgId: string,
): Promise<{ teamNumber: number } | { skipped: true; reason: string }> {
  const org = await client.query<{ teamNumber: number | null }>(
    `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
    [orgId],
  );
  const teamNumber = org.rows[0]?.teamNumber;
  if (!isDeepGameAnalysisTeam(teamNumber)) {
    return {
      skipped: true,
      reason: `deep_game_analysis is only enabled for FRC team ${DEEP_GAME_ANALYSIS_TEAM_NUMBER}`,
    };
  }
  return { teamNumber: DEEP_GAME_ANALYSIS_TEAM_NUMBER };
}

export async function gatherSeedSources(
  client: PoolClient,
  input: {
    orgId: string;
    runId: string;
    seasonYear: number;
    fetchImpl?: typeof fetch;
  },
): Promise<Array<{ url: string; title: string; kind: string; excerpt: string; fetchOk: boolean }>> {
  const seeds = seedSourcesForSeason(input.seasonYear);
  const gathered: Array<{ url: string; title: string; kind: string; excerpt: string; fetchOk: boolean }> = [];

  for (const seed of seeds) {
    let excerpt = "";
    let fetchOk = false;
    let error: string | null = null;
    try {
      const fetched = await safeAllowlistedFetch(seed.url, {
        fetchImpl: input.fetchImpl,
        timeoutMs: 12_000,
        maxExcerptChars: 6_000,
      });
      excerpt = fetched.excerpt;
      fetchOk = excerpt.trim().length > 40;
      if (!fetchOk) error = "excerpt_too_short";
    } catch (caught) {
      error = caught instanceof Error ? caught.message.slice(0, 400) : "fetch_failed";
    }

    await client.query(
      `INSERT INTO deep_game_analysis_sources
         (id, org_id, run_id, url, title, kind, fetch_ok, excerpt, error, fetched_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (run_id, url) DO UPDATE SET
         fetch_ok = excluded.fetch_ok,
         excerpt = excluded.excerpt,
         error = excluded.error,
         fetched_at = now()`,
      [
        randomUUID(),
        input.orgId,
        input.runId,
        seed.url,
        seed.title,
        seed.kind,
        fetchOk,
        excerpt.slice(0, 8000),
        error,
      ],
    );
    gathered.push({
      url: seed.url,
      title: seed.title,
      kind: seed.kind,
      excerpt,
      fetchOk,
    });
  }
  return gathered;
}

export async function runDeepGameAnalysisLoop(
  adapter: ChatAdapter,
  input: {
    seasonYear: number;
    loopSequence: number;
    sources: Array<{ url: string; title: string; kind: string; excerpt: string; fetchOk: boolean }>;
    previousGuess: DeepGameGuess | null;
    packHint?: { gameName: string; seasonTheme: string; status: string };
    clock?: DeepAnalysisClock;
    turnPaceMs?: number;
    minLoopMs?: number;
    onTurn?: (turn: DeepGameTurn, guess: DeepGameGuess) => Promise<void>;
  },
): Promise<{ guess: DeepGameGuess; turns: DeepGameTurn[] }> {
  const clock = input.clock ?? defaultClock();
  const loopStartedAt = clock.now();
  const evidenceUrls = input.sources.filter((source) => source.fetchOk).map((source) => source.url);
  let guess = input.previousGuess ?? emptyGuess();
  const turns: DeepGameTurn[] = [];

  for (const focus of ANALYSIS_TURN_FOCUSES) {
    const result = await adapter.complete({
      message: buildLoopTurnPrompt({
        seasonYear: input.seasonYear,
        focus,
        loopSequence: input.loopSequence,
        sources: input.sources,
        previousGuess: guess,
        packHint: input.packHint,
      }),
      context: [],
    });
    guess = parseDeepGameGuess(result.text, evidenceUrls);
    const turn: DeepGameTurn = {
      focus,
      notes: result.text.slice(0, 2000),
      model: adapter.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
    turns.push(turn);
    if (input.onTurn) await input.onTurn(turn, guess);
    if (loopStillOpen({ loopStartedAt, now: clock.now(), minLoopMs: input.minLoopMs ?? 0 })) {
      await clock.sleep(input.turnPaceMs ?? 0);
    }
  }

  while (loopStillOpen({ loopStartedAt, now: clock.now(), minLoopMs: input.minLoopMs ?? 0 })) {
    await clock.sleep(Math.min(input.turnPaceMs ?? 0, 60_000) || 1);
  }

  return { guess, turns };
}

export async function runDeepGameAnalysisJob(
  client: PoolClient,
  adapter: ChatAdapter,
  orgId: string,
  metadata: { runId?: string; seasonYear?: number; model?: string } = {},
  options: {
    clock?: DeepAnalysisClock;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    packHint?: { gameName: string; seasonTheme: string; status: string };
  } = {},
): Promise<DeepGameAnalysisJobResult> {
  const gate = await assertDeepAnalysisOrg(client, orgId);
  if ("skipped" in gate) {
    return {
      runId: metadata.runId ?? "",
      loopSequence: 0,
      continued: false,
      skipped: true,
      reason: gate.reason,
      guess: emptyGuess(),
    };
  }

  const pacing = readDeepAnalysisPacing(options.env);
  const clock = options.clock ?? defaultClock();

  let run = metadata.runId
    ? (
        await client.query<{
          id: string;
          seasonYear: number;
          status: string;
          startedAt: Date | null;
          loopCount: number;
          minHours: number;
          minLoops: number;
          model: string | null;
          latestGuess: DeepGameGuess | null;
        }>(
          `SELECT id, season_year AS "seasonYear", status, started_at AS "startedAt",
                  loop_count AS "loopCount", min_hours AS "minHours", min_loops AS "minLoops",
                  model, latest_guess AS "latestGuess"
             FROM deep_game_analysis_runs
            WHERE id = $1::uuid AND org_id = $2::uuid`,
          [metadata.runId, orgId],
        )
      ).rows[0]
    : undefined;

  if (!run) {
    const seasonYear = metadata.seasonYear ?? new Date().getUTCFullYear();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO deep_game_analysis_runs
         (org_id, season_year, status, started_at, min_hours, min_loops, model, started_by)
       VALUES ($1::uuid, $2, 'running', now(), $3, $4, $5, NULL)
       RETURNING id`,
      [orgId, seasonYear, pacing.minHours, pacing.minLoops, metadata.model ?? adapter.model],
    );
    run = {
      id: inserted.rows[0]!.id,
      seasonYear,
      status: "running",
      startedAt: clock.now(),
      loopCount: 0,
      minHours: pacing.minHours,
      minLoops: pacing.minLoops,
      model: metadata.model ?? adapter.model,
      latestGuess: null,
    };
  }

  if (run.status === "cancelled") {
    return {
      runId: run.id,
      loopSequence: run.loopCount,
      continued: false,
      skipped: true,
      reason: "cancelled",
      guess: run.latestGuess ?? emptyGuess(),
    };
  }

  if (run.status !== "running") {
    await client.query(
      `UPDATE deep_game_analysis_runs
          SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
        WHERE id = $1::uuid`,
      [run.id],
    );
  }

  const startedAt = run.startedAt ?? clock.now();
  let loopCount = run.loopCount;
  let guess = run.latestGuess ?? emptyGuess();

  while (
    shouldContinueDeepAnalysis({
      startedAt,
      now: clock.now(),
      minHours: run.minHours ?? pacing.minHours,
    })
  ) {
    const live = await client.query<{ status: string }>(
      `SELECT status FROM deep_game_analysis_runs WHERE id = $1::uuid`,
      [run.id],
    );
    if (live.rows[0]?.status === "cancelled") {
      return {
        runId: run.id,
        loopSequence: loopCount,
        continued: false,
        skipped: true,
        reason: "cancelled",
        guess,
      };
    }

    const sources = await gatherSeedSources(client, {
      orgId,
      runId: run.id,
      seasonYear: run.seasonYear,
      fetchImpl: options.fetchImpl,
    });

    const loopSequence = loopCount + 1;
    const loopId = randomUUID();
    await client.query(
      `INSERT INTO deep_game_analysis_loops
         (id, org_id, run_id, sequence, status, started_at, focus, notes, turns)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'running', now(), $5, '', '[]'::jsonb)`,
      [loopId, orgId, run.id, loopSequence, ANALYSIS_TURN_FOCUSES[0]],
    );

    const turns: DeepGameTurn[] = [];
    const cycle = await runDeepGameAnalysisLoop(adapter, {
      seasonYear: run.seasonYear,
      loopSequence,
      sources,
      previousGuess: guess,
      packHint: options.packHint,
      clock,
      turnPaceMs: pacing.turnPaceMs,
      minLoopMs: pacing.minLoopMs,
      onTurn: async (turn, nextGuess) => {
        turns.push(turn);
        await client.query(
          `UPDATE deep_game_analysis_loops
              SET turns = $2::jsonb, notes = $3, guess = $4::jsonb, focus = $5
            WHERE id = $1::uuid`,
          [loopId, JSON.stringify(turns), turn.notes.slice(0, 2000), JSON.stringify(nextGuess), turn.focus],
        );
        await client.query(
          `UPDATE deep_game_analysis_runs
              SET latest_guess = $2::jsonb, updated_at = now()
            WHERE id = $1::uuid`,
          [run.id, JSON.stringify(nextGuess)],
        );
      },
    });
    guess = cycle.guess;

    await client.query(
      `UPDATE deep_game_analysis_loops
          SET status = 'completed', completed_at = now(), guess = $2::jsonb, turns = $3::jsonb
        WHERE id = $1::uuid`,
      [loopId, JSON.stringify(guess), JSON.stringify(turns)],
    );

    const promptTokens = turns.reduce((sum, turn) => sum + turn.promptTokens, 0);
    const completionTokens = turns.reduce((sum, turn) => sum + turn.completionTokens, 0);
    const owner = await client.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM memberships
        WHERE org_id = $1::uuid AND role = 'owner' ORDER BY created_at LIMIT 1`,
      [orgId],
    );
    if (owner.rows[0]?.userId) {
      await client.query(
        `INSERT INTO ai_usage_events
           (org_id, user_id, feature, model, provider, key_source, prompt_tokens,
            completion_tokens, total_tokens, cost_usd, request_id, metadata)
         VALUES ($1,$2,$3,$4,$5,'local_cli',$6,$7,$8,0,$9,$10::jsonb)`,
        [
          orgId,
          owner.rows[0].userId,
          DEEP_GAME_ANALYSIS_FEATURE,
          adapter.model,
          adapter.provider,
          promptTokens,
          completionTokens,
          promptTokens + completionTokens,
          `deep-game-${loopId}`,
          JSON.stringify({ runId: run.id, loopSequence, path: "free_relay" }),
        ],
      );
    }

    loopCount = loopSequence;
    await client.query(
      `UPDATE deep_game_analysis_runs
          SET loop_count = $2, latest_guess = $3::jsonb, status = 'running', updated_at = now()
        WHERE id = $1::uuid`,
      [run.id, loopCount, JSON.stringify(guess)],
    );
  }

  await client.query(
    `UPDATE deep_game_analysis_runs
        SET loop_count = $2, latest_guess = $3::jsonb, status = 'completed',
            completed_at = now(), updated_at = now()
      WHERE id = $1::uuid`,
    [run.id, loopCount, JSON.stringify(guess)],
  );
  return { runId: run.id, loopSequence: loopCount, continued: false, guess };
}
