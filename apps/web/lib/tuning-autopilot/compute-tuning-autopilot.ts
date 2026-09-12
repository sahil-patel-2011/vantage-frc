import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { scoreIterations, suggestNextGains } from ".";
import type {
  ScoredIteration,
  TuningControllerType,
  TuningGains,
  TuningIteration,
  TuningSession,
  TuningSessionStatus,
  TuningSuggestion,
} from "./types";

export type TuningAutopilotSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type TuningSessionSummary = {
  session: TuningSession;
  iterationCount: number;
  bestScore: number | null;
  latestScore: number | null;
};

export type TuningAutopilotView =
  | {
      status: "setup_required";
      message: string;
      steps: TuningAutopilotSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      sessions: TuningSessionSummary[];
      selectedSessionId: string | null;
      iterations: ScoredIteration[];
      bestIterationId: string | null;
      suggestion: TuningSuggestion | null;
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

type SessionRow = {
  id: string;
  seasonYear: number;
  subsystem: string;
  controllerType: string;
  goal: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function isControllerType(value: unknown): value is TuningControllerType {
  return value === "pid" || value === "pidf" || value === "feedforward";
}

function isSessionStatus(value: unknown): value is TuningSessionStatus {
  return value === "active" || value === "converged" || value === "abandoned";
}

function mapSession(row: SessionRow): TuningSession {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    subsystem: row.subsystem,
    controllerType: isControllerType(row.controllerType) ? row.controllerType : "pid",
    goal: row.goal,
    status: isSessionStatus(row.status) ? row.status : "active",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type IterationRow = {
  id: string;
  sessionId: string;
  iterationIndex: number;
  kP: string;
  kI: string;
  kD: string;
  kS: string;
  kV: string;
  kG: string;
  overshootPct: string;
  settlingTimeSec: string;
  steadyStateError: string;
  oscillating: boolean;
  notes: string;
  loggedBy: string;
  createdAt: string;
};

function mapIteration(row: IterationRow): TuningIteration {
  const gains: TuningGains = {
    kP: Number(row.kP) || 0,
    kI: Number(row.kI) || 0,
    kD: Number(row.kD) || 0,
    kS: Number(row.kS) || 0,
    kV: Number(row.kV) || 0,
    kG: Number(row.kG) || 0,
  };
  return {
    id: row.id,
    sessionId: row.sessionId,
    iterationIndex: row.iterationIndex,
    gains,
    result: {
      overshootPct: Number(row.overshootPct) || 0,
      settlingTimeSec: Number(row.settlingTimeSec) || 0,
      steadyStateError: Number(row.steadyStateError) || 0,
      oscillating: Boolean(row.oscillating),
    },
    notes: row.notes,
    loggedBy: row.loggedBy,
    createdAt: row.createdAt,
  };
}

export async function computeTuningAutopilotView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null; sessionId?: string | null },
): Promise<TuningAutopilotView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to log tuning sessions.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before logging gain sets.",
          href: "/workspace",
        },
        {
          id: "cad",
          label: "Open CAD",
          detail: "Mechanism geometry stays blank until connected.",
          href: "/build?tab=cad",
        },
        {
          id: "fmea",
          label: "Open Failure log",
          detail: "Failure modes stay blank until scored.",
          href: "/build?tab=fmea",
        },
        {
          id: "practice",
          label: "Open Practice",
          detail: "Practice plans stay empty until scheduled.",
          href: "/team?tab=practice",
        },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [sessionResult, seasonResult] = await Promise.all([
    client.query<SessionRow>(
      `SELECT id, season_year AS "seasonYear", subsystem, controller_type AS "controllerType",
              goal, status, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tuning_autopilot_sessions
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM tuning_autopilot_sessions WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const sessions = sessionResult.rows.map(mapSession);
  const sessionIds = sessions.map((s) => s.id);

  let iterationsBySession = new Map<string, TuningIteration[]>();
  if (sessionIds.length > 0) {
    const iterationResult = await client.query<IterationRow>(
      `SELECT id, session_id AS "sessionId", iteration_index AS "iterationIndex",
              k_p AS "kP", k_i AS "kI", k_d AS "kD", k_s AS "kS", k_v AS "kV", k_g AS "kG",
              overshoot_pct AS "overshootPct", settling_time_sec AS "settlingTimeSec",
              steady_state_error AS "steadyStateError", oscillating, notes,
              logged_by AS "loggedBy", created_at AS "createdAt"
       FROM tuning_autopilot_iterations
       WHERE org_id = $1 AND session_id = ANY($2::uuid[])
       ORDER BY session_id, iteration_index ASC`,
      [org.orgId, sessionIds],
    );
    iterationsBySession = new Map();
    for (const row of iterationResult.rows) {
      const iteration = mapIteration(row);
      const list = iterationsBySession.get(iteration.sessionId) ?? [];
      list.push(iteration);
      iterationsBySession.set(iteration.sessionId, list);
    }
  }

  const sessionSummaries: TuningSessionSummary[] = sessions.map((session) => {
    const iterations = iterationsBySession.get(session.id) ?? [];
    const scored = scoreIterations(iterations);
    const scores = scored.map((s) => s.score);
    const latest = scored.length > 0 ? scored[scored.length - 1] : null;
    return {
      session,
      iterationCount: iterations.length,
      bestScore: scores.length > 0 ? Math.max(...scores) : null,
      latestScore: latest ? latest.score : null,
    };
  });

  const requestedSessionId = input.sessionId ?? null;
  const selectedSessionId =
    requestedSessionId && sessionIds.includes(requestedSessionId) ? requestedSessionId : (sessionIds[0] ?? null);

  const selectedIterations = selectedSessionId ? (iterationsBySession.get(selectedSessionId) ?? []) : [];
  const scoredIterations = scoreIterations(selectedIterations);
  const suggestion = selectedSessionId ? suggestNextGains(selectedIterations) : null;
  const bestIterationId =
    scoredIterations.length > 0
      ? scoredIterations.reduce((best, current) => (current.score > best.score ? current : best)).id
      : null;

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    sessions: sessionSummaries,
    selectedSessionId,
    iterations: scoredIterations,
    bestIterationId,
    suggestion,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createSession(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    subsystem: string;
    controllerType: TuningControllerType;
    goal: string;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tuning_autopilot_sessions (org_id, season_year, subsystem, controller_type, goal, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [input.orgId, input.seasonYear, input.subsystem, input.controllerType, input.goal, input.userId],
  );
  return result.rows[0]!.id;
}

export async function updateSessionStatus(
  client: PoolClient,
  input: { orgId: string; sessionId: string; status: TuningSessionStatus },
): Promise<void> {
  await client.query(
    `UPDATE tuning_autopilot_sessions SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.sessionId, input.orgId],
  );
}

export async function deleteSession(
  client: PoolClient,
  input: { orgId: string; sessionId: string },
): Promise<void> {
  await client.query(`DELETE FROM tuning_autopilot_sessions WHERE id = $1 AND org_id = $2`, [
    input.sessionId,
    input.orgId,
  ]);
}

/**
 * Log a tuning iteration (gains actually run + observed result) and recompute the next-gain
 * suggestion from the session's own logged trend. The suggestion math is fully deterministic
 * (suggestNextGains); meteredAI wraps it so the run is billed and audited through the standard
 * usage-ledger path, matching every other metered feature.
 */
export async function logIteration(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sessionId: string;
    gains: TuningGains;
    result: {
      overshootPct: number;
      settlingTimeSec: number;
      steadyStateError: number;
      oscillating: boolean;
    };
    notes: string;
  },
): Promise<TuningSuggestion | null> {
  const existingResult = await client.query<{ nextIndex: string }>(
    `SELECT COALESCE(MAX(iteration_index), -1) + 1 AS "nextIndex"
     FROM tuning_autopilot_iterations WHERE session_id = $1 AND org_id = $2`,
    [input.sessionId, input.orgId],
  );
  const nextIndex = Number(existingResult.rows[0]?.nextIndex ?? 0);

  await client.query(
    `INSERT INTO tuning_autopilot_iterations (
       org_id, session_id, iteration_index, k_p, k_i, k_d, k_s, k_v, k_g,
       overshoot_pct, settling_time_sec, steady_state_error, oscillating, notes, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.orgId,
      input.sessionId,
      nextIndex,
      input.gains.kP,
      input.gains.kI,
      input.gains.kD,
      input.gains.kS,
      input.gains.kV,
      input.gains.kG,
      input.result.overshootPct,
      input.result.settlingTimeSec,
      input.result.steadyStateError,
      input.result.oscillating,
      input.notes,
      input.userId,
    ],
  );
  await client.query(`UPDATE tuning_autopilot_sessions SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
    input.sessionId,
    input.orgId,
  ]);

  const iterationResult = await client.query<IterationRow>(
    `SELECT id, session_id AS "sessionId", iteration_index AS "iterationIndex",
            k_p AS "kP", k_i AS "kI", k_d AS "kD", k_s AS "kS", k_v AS "kV", k_g AS "kG",
            overshoot_pct AS "overshootPct", settling_time_sec AS "settlingTimeSec",
            steady_state_error AS "steadyStateError", oscillating, notes,
            logged_by AS "loggedBy", created_at AS "createdAt"
     FROM tuning_autopilot_iterations
     WHERE org_id = $1 AND session_id = $2
     ORDER BY iteration_index ASC`,
    [input.orgId, input.sessionId],
  );
  const iterations = iterationResult.rows.map(mapIteration);

  return meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "tuning_autopilot",
    requestId: `tuning-autopilot-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      sessionId: input.sessionId,
      iterationCount: iterations.length,
      note: "Deterministic next-gain suggestion from the session's own logged trend — no external model call",
    },
    invoke: async () => ({
      value: suggestNextGains(iterations),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-tuning-autopilot-v1",
      provider: "vantage-local",
    }),
  });
}

export async function deleteIteration(
  client: PoolClient,
  input: { orgId: string; iterationId: string },
): Promise<void> {
  await client.query(`DELETE FROM tuning_autopilot_iterations WHERE id = $1 AND org_id = $2`, [
    input.iterationId,
    input.orgId,
  ]);
}
