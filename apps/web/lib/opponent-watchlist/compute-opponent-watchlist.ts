import type { PoolClient } from "@neondatabase/serverless";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { alertMessage, classifyEpaChange, classifyScheduleChange, round1, summarizeWatchlist, teamLabel } from ".";
import type { WatchlistAlert, WatchlistEntry, WatchlistSummary } from "./types";
import { loadWatchlistTeamKeys } from "../watchlist";

export type WatchlistSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type OpponentWatchlistView =
  | {
      status: "setup_required";
      message: string;
      steps: WatchlistSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      entries: WatchlistEntry[];
      alerts: WatchlistAlert[];
      summary: WatchlistSummary;
      /** Org watchlist keys in scout-queue order — watched teams sort earlier on coverage. */
      coveragePriorityTeamKeys: string[];
      computedAt: string;
    };

function setupSteps(orgId: string | null): WatchlistSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Opponent Watchlist.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick lists stay empty until real metrics exist.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "epa-trend-alerts",
      label: "Open EPA Trend Alerts",
      detail: "EPA swings stay blank until you watch real teams.",
      href: hubHref("/competition", "epa-trend-alerts", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scout rows stay blank until your team enters them.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

function setupRequiredView(orgId: string | null = null): OpponentWatchlistView {
  return {
    status: "setup_required",
    message: "Choose your team to build an opponent watchlist.",
    steps: setupSteps(orgId),
    orgId,
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

type EntryRow = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  note: string | null;
  notifySchedule: boolean;
  notifyEpa: boolean;
  createdAt: string;
};

type MetricsRow = {
  teamKey: string;
  eventKey: string;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  rank: number | null;
};

type MatchRow = {
  teamKey: string;
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
};

type SnapshotRow = {
  entryId: string;
  teamKey: string;
  epaTotal: number | null;
  nextMatchKey: string | null;
  nextMatchTime: string | null;
};

export async function computeOpponentWatchlistView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<OpponentWatchlistView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequiredView();

  const [entryResult, coveragePriorityTeamKeys] = await Promise.all([
    client.query<EntryRow>(
      `SELECT id, team_key AS "teamKey", team_number AS "teamNumber", note,
              notify_schedule AS "notifySchedule", notify_epa AS "notifyEpa",
              created_at::text AS "createdAt"
       FROM opponent_watchlist_entries
       WHERE org_id = $1 AND created_by = $2
       ORDER BY created_at DESC`,
      [org.orgId, input.userId],
    ).then(async (result) => {
      if (result.rows.length === 0) return { rows: [] as (EntryRow & { nickname: string | null })[] };
      const teamKeys = result.rows.map((r) => r.teamKey);
      const nicknames = await client.query<{ teamKey: string; nickname: string | null }>(
        `SELECT team_key AS "teamKey", nickname FROM teams_ref WHERE team_key = ANY($1::text[])`,
        [teamKeys],
      );
      const nickByKey = new Map(nicknames.rows.map((r) => [r.teamKey, r.nickname]));
      return { rows: result.rows.map((r) => ({ ...r, nickname: nickByKey.get(r.teamKey) ?? null })) };
    }),
    loadWatchlistTeamKeys(client, org.orgId),
  ]);

  const entryRows = entryResult.rows;

  if (entryRows.length === 0) {
    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      entries: [],
      alerts: [],
      summary: summarizeWatchlist([], []),
      coveragePriorityTeamKeys,
      computedAt: new Date().toISOString(),
    };
  }

  const teamKeys = entryRows.map((r) => r.teamKey);
  const entryIds = entryRows.map((r) => r.id);

  const [metricsResult, matchResult, snapshotResult] = await Promise.all([
    client.query<MetricsRow>(
      `SELECT DISTINCT ON (team_key) team_key AS "teamKey", event_key AS "eventKey",
              epa_total AS "epaTotal", epa_auto AS "epaAuto", epa_teleop AS "epaTeleop",
              epa_endgame AS "epaEndgame", rank
       FROM team_event_metrics
       WHERE team_key = ANY($1::text[])
       ORDER BY team_key, synced_at DESC`,
      [teamKeys],
    ),
    client.query<MatchRow>(
      // team_key belongs to the `teams` derived table, not the lateral `m`, which
      // selects only match columns. Qualifying it as m.team_key threw
      // `column m.team_key does not exist` and took the whole watchlist read (and
      // the add-entry write that refreshes it) down with it.
      `SELECT DISTINCT ON (teams.team_key) teams.team_key AS "teamKey", m.match_key AS "matchKey",
              m.event_key AS "eventKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
              COALESCE(m.predicted_time, m.event_time)::text AS "scheduledTime"
       FROM (
         SELECT unnest($1::text[]) AS team_key
       ) teams
       CROSS JOIN LATERAL (
         SELECT match_key, event_key, comp_level, match_number, predicted_time, event_time
         FROM matches_ref
         WHERE (red_alliance->'teamKeys' ? teams.team_key OR blue_alliance->'teamKeys' ? teams.team_key)
           AND actual_time IS NULL
         ORDER BY COALESCE(predicted_time, event_time) ASC NULLS LAST
         LIMIT 1
       ) m
       ORDER BY teams.team_key`,
      [teamKeys],
    ),
    client.query<SnapshotRow>(
      `SELECT entry_id AS "entryId", team_key AS "teamKey", epa_total AS "epaTotal",
              next_match_key AS "nextMatchKey", next_match_time AS "nextMatchTime"
       FROM opponent_watchlist_snapshots
       WHERE org_id = $1 AND entry_id = ANY($2::uuid[])`,
      [org.orgId, entryIds],
    ),
  ]);

  const metricsByTeam = new Map(metricsResult.rows.map((r) => [r.teamKey, r]));
  const matchByTeam = new Map(matchResult.rows.map((r) => [r.teamKey, r]));
  const snapshotByEntry = new Map(snapshotResult.rows.map((r) => [r.entryId, r]));

  const entries: WatchlistEntry[] = [];
  const alerts: WatchlistAlert[] = [];

  for (const row of entryRows) {
    const metrics = metricsByTeam.get(row.teamKey) ?? null;
    const match = matchByTeam.get(row.teamKey) ?? null;
    const snapshot = snapshotByEntry.get(row.id) ?? null;
    const label = teamLabel(row.teamNumber, row.nickname);

    const currentEpa = metrics?.epaTotal != null ? Number(metrics.epaTotal) : null;
    const currentMatchKey = match?.matchKey ?? null;
    const currentMatchTime = match?.scheduledTime ?? null;

    if (row.notifyEpa) {
      const epaChange = classifyEpaChange({ previousEpa: snapshot?.epaTotal ?? null, currentEpa });
      if (epaChange) {
        alerts.push({
          entryId: row.id,
          teamKey: row.teamKey,
          teamNumber: row.teamNumber,
          nickname: row.nickname,
          type: epaChange.type,
          message: alertMessage(epaChange.type, label, {
            previous: snapshot?.epaTotal != null ? round1(snapshot.epaTotal).toString() : null,
            current: currentEpa != null ? round1(currentEpa).toString() : null,
          }),
          previousValue: snapshot?.epaTotal != null ? round1(snapshot.epaTotal).toString() : null,
          currentValue: currentEpa != null ? round1(currentEpa).toString() : null,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    if (row.notifySchedule) {
      const scheduleChange = classifyScheduleChange({
        previousMatchKey: snapshot?.nextMatchKey ?? null,
        previousScheduledTime: snapshot?.nextMatchTime ?? null,
        currentMatchKey,
        currentScheduledTime: currentMatchTime,
      });
      if (scheduleChange) {
        alerts.push({
          entryId: row.id,
          teamKey: row.teamKey,
          teamNumber: row.teamNumber,
          nickname: row.nickname,
          type: scheduleChange.type,
          message: alertMessage(scheduleChange.type, label, {
            previous: snapshot?.nextMatchTime ?? null,
            current: currentMatchTime,
          }),
          previousValue: snapshot?.nextMatchTime ?? null,
          currentValue: currentMatchTime,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    entries.push({
      id: row.id,
      teamKey: row.teamKey,
      teamNumber: row.teamNumber,
      nickname: row.nickname,
      note: row.note,
      notifySchedule: row.notifySchedule,
      notifyEpa: row.notifyEpa,
      createdAt: row.createdAt,
      current: metrics
        ? {
            eventKey: metrics.eventKey,
            epaTotal: currentEpa,
            epaAuto: metrics.epaAuto != null ? Number(metrics.epaAuto) : null,
            epaTeleop: metrics.epaTeleop != null ? Number(metrics.epaTeleop) : null,
            epaEndgame: metrics.epaEndgame != null ? Number(metrics.epaEndgame) : null,
            rank: metrics.rank != null ? Number(metrics.rank) : null,
          }
        : null,
      nextMatch: match
        ? {
            matchKey: match.matchKey,
            eventKey: match.eventKey,
            compLevel: match.compLevel,
            matchNumber: Number(match.matchNumber) || 0,
            scheduledTime: currentMatchTime,
          }
        : null,
    });

    await client.query(
      `INSERT INTO opponent_watchlist_snapshots (org_id, entry_id, team_key, epa_total, next_match_key, next_match_time)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz)
       ON CONFLICT (org_id, entry_id) DO UPDATE SET
         team_key = EXCLUDED.team_key,
         epa_total = EXCLUDED.epa_total,
         next_match_key = EXCLUDED.next_match_key,
         next_match_time = EXCLUDED.next_match_time,
         captured_at = now()`,
      [org.orgId, row.id, row.teamKey, currentEpa, currentMatchKey, currentMatchTime],
    );
  }

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    entries,
    alerts,
    summary: summarizeWatchlist(entries, alerts),
    coveragePriorityTeamKeys,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addWatchlistEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    teamKey: string;
    teamNumber: number | null;
    note: string | null;
    notifySchedule: boolean;
    notifyEpa: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO opponent_watchlist_entries (org_id, created_by, team_key, team_number, note, notify_schedule, notify_epa)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (org_id, created_by, team_key) DO UPDATE SET
       team_number = EXCLUDED.team_number,
       note = EXCLUDED.note,
       notify_schedule = EXCLUDED.notify_schedule,
       notify_epa = EXCLUDED.notify_epa`,
    [
      input.orgId,
      input.userId,
      input.teamKey,
      input.teamNumber,
      input.note,
      input.notifySchedule,
      input.notifyEpa,
    ],
  );
}

export async function removeWatchlistEntry(
  client: PoolClient,
  input: { orgId: string; userId: string; entryId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM opponent_watchlist_entries WHERE id = $1 AND org_id = $2 AND created_by = $3`,
    [input.entryId, input.orgId, input.userId],
  );
}
