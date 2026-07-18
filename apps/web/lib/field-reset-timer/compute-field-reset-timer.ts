import type { PoolClient } from "@neondatabase/serverless";
import { computeFieldResetTimerReadiness, summarizeSessionCycles } from ".";
import type {
  FieldResetTimerCycle,
  FieldResetTimerReadiness,
  FieldResetTimerSession,
  FieldResetTimerSessionSummary,
} from "./types";

export type FieldResetTimerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type FieldResetTimerView =
  | {
      status: "setup_required";
      message: string;
      steps: FieldResetTimerSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      sessions: FieldResetTimerSession[];
      cycles: FieldResetTimerCycle[];
      sessionSummaries: FieldResetTimerSessionSummary[];
      readiness: FieldResetTimerReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type SessionRow = {
  id: string;
  label: string;
  occurredOn: string;
  seasonYear: number;
  notes: string | null;
  cycleCount: string | number;
};

type CycleRow = {
  id: string;
  sessionId: string;
  cycleNumber: number;
  resetSeconds: string | number;
  cycleSeconds: string | number | null;
  note: string | null;
  recordedAt: string;
};

function mapSession(row: SessionRow): FieldResetTimerSession {
  return {
    id: row.id,
    label: row.label,
    occurredOn: row.occurredOn,
    seasonYear: row.seasonYear,
    notes: row.notes,
    cycleCount: Number(row.cycleCount) || 0,
  };
}

function mapCycle(row: CycleRow): FieldResetTimerCycle {
  return {
    id: row.id,
    sessionId: row.sessionId,
    cycleNumber: Number(row.cycleNumber) || 0,
    resetSeconds: Number(row.resetSeconds) || 0,
    cycleSeconds: row.cycleSeconds == null ? null : Number(row.cycleSeconds),
    note: row.note,
    recordedAt: row.recordedAt,
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

export async function computeFieldResetTimerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<FieldResetTimerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to start timing field-reset practice cycles.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [sessionResult, seasonResult] = await Promise.all([
    client.query<SessionRow>(
      `SELECT s.id, s.label, s.occurred_on::text AS "occurredOn", s.season_year AS "seasonYear", s.notes,
              COUNT(c.id) AS "cycleCount"
       FROM field_reset_timer_sessions s
       LEFT JOIN field_reset_timer_cycles c ON c.session_id = s.id
       WHERE s.org_id = $1 AND s.season_year = $2
       GROUP BY s.id
       ORDER BY s.occurred_on DESC, s.created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM field_reset_timer_sessions WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const sessions = sessionResult.rows.map(mapSession);
  const sessionIds = sessions.map((s) => s.id);

  const cycleResult = sessionIds.length
    ? await client.query<CycleRow>(
        `SELECT id, session_id AS "sessionId", cycle_number AS "cycleNumber",
                reset_seconds AS "resetSeconds", cycle_seconds AS "cycleSeconds", note,
                created_at AS "recordedAt"
         FROM field_reset_timer_cycles
         WHERE org_id = $1 AND session_id = ANY($2::uuid[])
         ORDER BY session_id, cycle_number`,
        [org.orgId, sessionIds],
      )
    : { rows: [] as CycleRow[] };

  const cycles = cycleResult.rows.map(mapCycle);
  const sessionSummaries = sessions
    .map((session) => summarizeSessionCycles(session.id, cycles))
    .filter((summary): summary is FieldResetTimerSessionSummary => summary != null);
  const readiness = computeFieldResetTimerReadiness(cycles, sessions.length);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    sessions,
    cycles,
    sessionSummaries,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createSession(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    label: string;
    occurredOn: string;
    seasonYear: number;
    notes: string | null;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO field_reset_timer_sessions (org_id, label, occurred_on, season_year, notes, created_by)
     VALUES ($1,$2,$3::date,$4,$5,$6)
     RETURNING id`,
    [input.orgId, input.label, input.occurredOn, input.seasonYear, input.notes, input.userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Failed to create session");
  return row.id;
}

export async function deleteSession(
  client: PoolClient,
  input: { orgId: string; sessionId: string },
): Promise<void> {
  await client.query(`DELETE FROM field_reset_timer_sessions WHERE id = $1 AND org_id = $2`, [
    input.sessionId,
    input.orgId,
  ]);
}

export async function logCycle(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sessionId: string;
    cycleNumber: number;
    resetSeconds: number;
    cycleSeconds: number | null;
    note: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO field_reset_timer_cycles (
       org_id, session_id, cycle_number, reset_seconds, cycle_seconds, note, recorded_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.orgId,
      input.sessionId,
      input.cycleNumber,
      input.resetSeconds,
      input.cycleSeconds,
      input.note,
      input.userId,
    ],
  );
}

export async function deleteCycle(
  client: PoolClient,
  input: { orgId: string; cycleId: string },
): Promise<void> {
  await client.query(`DELETE FROM field_reset_timer_cycles WHERE id = $1 AND org_id = $2`, [
    input.cycleId,
    input.orgId,
  ]);
}
