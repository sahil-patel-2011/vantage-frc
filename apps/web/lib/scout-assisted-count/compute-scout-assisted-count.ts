import type { PoolClient } from "@neondatabase/serverless";
import { summarizeSessions } from ".";
import type { CountSession, CountSessionStatus, CountSummary, CountTap } from "./types";
import { resolveScoutOrg } from "../scout-org-access";

export const COUNT_METRIC_KEYS = [
  "auto_pieces",
  "teleop_pieces",
  "cycles",
  "defense_events",
  "fouls",
  "other",
] as const;
export type CountMetricKey = (typeof COUNT_METRIC_KEYS)[number];

export type CountSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutAssistedCountView =
  | {
      status: "setup_required";
      message: string;
      steps: CountSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      sessions: CountSession[];
      summary: CountSummary;
      computedAt: string;
    };

type SessionRow = {
  id: string;
  metricKey: string;
  matchKey: string | null;
  teamKey: string | null;
  label: string;
  status: CountSessionStatus;
  tapCount: number;
  startedBy: string;
  startedAt: string;
  closedAt: string | null;
};

type TapRow = {
  id: string;
  sessionId: string;
  delta: number;
  tappedBy: string;
  tappedAt: string;
};

function mapTap(row: TapRow): CountTap {
  return {
    id: row.id,
    sessionId: row.sessionId,
    delta: Number(row.delta) || 0,
    tappedBy: row.tappedBy,
    tappedAt: row.tappedAt,
  };
}

function mapSession(row: SessionRow, taps: CountTap[]): CountSession {
  return {
    id: row.id,
    metricKey: row.metricKey,
    matchKey: row.matchKey,
    teamKey: row.teamKey,
    label: row.label,
    status: row.status,
    tapCount: Number(row.tapCount) || 0,
    startedBy: row.startedBy,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    taps,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

export async function computeScoutAssistedCountView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ScoutAssistedCountView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to start scout-assisted counting.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [sessionResult, tapResult] = await Promise.all([
    client.query<SessionRow>(
      `SELECT id, metric_key AS "metricKey", match_key AS "matchKey", team_key AS "teamKey",
              label, status, tap_count AS "tapCount", started_by AS "startedBy",
              started_at::text AS "startedAt", closed_at::text AS "closedAt"
       FROM scout_assisted_count_sessions
       WHERE org_id = $1
       ORDER BY started_at DESC
       LIMIT 100`,
      [org.orgId],
    ),
    client.query<TapRow>(
      `SELECT t.id, t.session_id AS "sessionId", t.delta, t.tapped_by AS "tappedBy",
              t.tapped_at::text AS "tappedAt"
       FROM scout_assisted_count_taps t
       JOIN scout_assisted_count_sessions s ON s.id = t.session_id
       WHERE s.org_id = $1
       ORDER BY t.tapped_at ASC
       LIMIT 5000`,
      [org.orgId],
    ),
  ]);

  const tapsBySession = new Map<string, CountTap[]>();
  for (const row of tapResult.rows) {
    const tap = mapTap(row);
    const list = tapsBySession.get(tap.sessionId) ?? [];
    list.push(tap);
    tapsBySession.set(tap.sessionId, list);
  }

  const sessions = sessionResult.rows.map((row) => mapSession(row, tapsBySession.get(row.id) ?? []));
  const summary = summarizeSessions(sessions);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    sessions,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function startSession(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    metricKey: CountMetricKey;
    matchKey: string | null;
    teamKey: string | null;
    label: string;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO scout_assisted_count_sessions (
       org_id, metric_key, match_key, team_key, label, started_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [input.orgId, input.metricKey, input.matchKey, input.teamKey, input.label, input.userId],
  );
  return result.rows[0]!.id;
}

export async function recordTap(
  client: PoolClient,
  input: { orgId: string; userId: string; sessionId: string; delta: number },
): Promise<void> {
  const delta = Number.isFinite(input.delta) && input.delta !== 0 ? Math.round(input.delta) : 1;
  await client.query(
    `INSERT INTO scout_assisted_count_taps (org_id, session_id, delta, tapped_by)
     SELECT $1, id, $3, $4 FROM scout_assisted_count_sessions WHERE id = $2 AND org_id = $1`,
    [input.orgId, input.sessionId, delta, input.userId],
  );
  await client.query(
    `UPDATE scout_assisted_count_sessions
     SET tap_count = GREATEST(0, tap_count + $3)
     WHERE id = $2 AND org_id = $1`,
    [input.orgId, input.sessionId, delta],
  );
}

export async function closeSession(
  client: PoolClient,
  input: { orgId: string; sessionId: string },
): Promise<void> {
  await client.query(
    `UPDATE scout_assisted_count_sessions
     SET status = 'closed', closed_at = now()
     WHERE id = $1 AND org_id = $2 AND status = 'open'`,
    [input.sessionId, input.orgId],
  );
}
