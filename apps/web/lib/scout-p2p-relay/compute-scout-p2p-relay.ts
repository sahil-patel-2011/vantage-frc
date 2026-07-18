import type { PoolClient } from "@neondatabase/serverless";
import { summarizeRelay, summarizeSessionEntries } from ".";
import type { RelayDeviceRole, RelayEntry, RelaySession, RelaySessionStatus, RelaySummary } from "./types";
import { resolveScoutOrg } from "../scout-org-access";

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export type RelaySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutP2pRelayView =
  | {
      status: "setup_required";
      message: string;
      steps: RelaySetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      sessions: RelaySession[];
      entries: RelayEntry[];
      summary: RelaySummary;
      computedAt: string;
    };

type SessionRow = {
  id: string;
  eventKey: string;
  seasonYear: number;
  captainDeviceLabel: string;
  status: RelaySessionStatus;
  startedAt: string;
  closedAt: string | null;
};

type EntryRow = {
  id: string;
  sessionId: string;
  deviceLabel: string;
  deviceRole: RelayDeviceRole;
  entriesContributed: number;
  conflictsResolved: number;
  uplinked: boolean;
  mergedAt: string;
};

function mapEntry(row: EntryRow): RelayEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    deviceLabel: row.deviceLabel,
    deviceRole: row.deviceRole,
    entriesContributed: Number(row.entriesContributed) || 0,
    conflictsResolved: Number(row.conflictsResolved) || 0,
    uplinked: Boolean(row.uplinked),
    mergedAt: row.mergedAt,
  };
}

function mapSession(row: SessionRow, entries: RelayEntry[]): RelaySession {
  const rollup = summarizeSessionEntries(entries);
  return {
    id: row.id,
    eventKey: row.eventKey,
    seasonYear: row.seasonYear,
    captainDeviceLabel: row.captainDeviceLabel,
    status: row.status,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    deviceCount: rollup.deviceCount,
    entriesMerged: rollup.entriesMerged,
    conflictsResolved: rollup.conflictsResolved,
    uplinkRate: rollup.uplinkRate,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

export async function computeScoutP2pRelayView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ScoutP2pRelayView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to run device-to-device scout sync sessions.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [sessionResult, seasonResult] = await Promise.all([
    client.query<SessionRow>(
      `SELECT id, event_key AS "eventKey", season_year AS "seasonYear",
              captain_device_label AS "captainDeviceLabel", status,
              started_at::text AS "startedAt", closed_at::text AS "closedAt"
       FROM scout_p2p_relay_sessions
       WHERE org_id = $1 AND season_year = $2
       ORDER BY started_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM scout_p2p_relay_sessions WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const sessionIds = sessionResult.rows.map((row) => row.id);
  const entryResult = sessionIds.length
    ? await client.query<EntryRow>(
        `SELECT id, session_id AS "sessionId", device_label AS "deviceLabel", device_role AS "deviceRole",
                entries_contributed AS "entriesContributed", conflicts_resolved AS "conflictsResolved",
                uplinked, merged_at::text AS "mergedAt"
         FROM scout_p2p_relay_entries
         WHERE org_id = $1 AND session_id = ANY($2::uuid[])
         ORDER BY merged_at DESC`,
        [org.orgId, sessionIds],
      )
    : { rows: [] as EntryRow[] };

  const entries = entryResult.rows.map(mapEntry);
  const entriesBySession = new Map<string, RelayEntry[]>();
  for (const entry of entries) {
    const bucket = entriesBySession.get(entry.sessionId) ?? [];
    bucket.push(entry);
    entriesBySession.set(entry.sessionId, bucket);
  }

  const sessions = sessionResult.rows.map((row) => mapSession(row, entriesBySession.get(row.id) ?? []));
  const summary = summarizeRelay(sessions);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    sessions,
    entries,
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
    eventKey: string;
    captainDeviceLabel: string;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO scout_p2p_relay_sessions (org_id, event_key, season_year, captain_device_label, created_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.orgId, input.eventKey, input.seasonYear, input.captainDeviceLabel, input.userId],
  );
}

export async function logEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sessionId: string;
    deviceLabel: string;
    deviceRole: RelayDeviceRole;
    entriesContributed: number;
    conflictsResolved: number;
    uplinked: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO scout_p2p_relay_entries (
       org_id, session_id, device_label, device_role, entries_contributed, conflicts_resolved, uplinked, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.sessionId,
      input.deviceLabel,
      input.deviceRole,
      Math.max(0, Math.round(input.entriesContributed)),
      Math.max(0, Math.round(input.conflictsResolved)),
      input.uplinked,
      input.userId,
    ],
  );
}

export async function updateSessionStatus(
  client: PoolClient,
  input: { orgId: string; sessionId: string; status: RelaySessionStatus },
): Promise<void> {
  await client.query(
    `UPDATE scout_p2p_relay_sessions
     SET status = $1, closed_at = CASE WHEN $1 = 'closed' THEN now() ELSE closed_at END
     WHERE id = $2 AND org_id = $3`,
    [input.status, input.sessionId, input.orgId],
  );
}

export async function deleteSession(
  client: PoolClient,
  input: { orgId: string; sessionId: string },
): Promise<void> {
  await client.query(`DELETE FROM scout_p2p_relay_sessions WHERE id = $1 AND org_id = $2`, [
    input.sessionId,
    input.orgId,
  ]);
}
