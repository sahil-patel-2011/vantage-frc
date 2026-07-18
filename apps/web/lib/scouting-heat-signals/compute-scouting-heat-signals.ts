import type { PoolClient } from "@neondatabase/serverless";
import { computeTeamHeatSignal, summarizeHeatSignals } from ".";
import type { HeatDirection, HeatSignalEntry, HeatSignalSummary, TeamHeatSignal } from "./types";

export type ScoutingHeatSignalsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutingHeatSignalsView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutingHeatSignalsSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      teams: TeamHeatSignal[];
      summary: HeatSignalSummary;
      computedAt: string;
    };

type EntryRow = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  observedOn: string;
  direction: HeatDirection;
  metricValue: string | null;
  note: string | null;
  matchKey: string | null;
  loggedBy: string;
  createdAt: string;
};

function mapEntry(row: EntryRow): HeatSignalEntry {
  return {
    id: row.id,
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    nickname: row.nickname,
    observedOn: row.observedOn,
    direction: row.direction,
    metricValue: row.metricValue != null ? Number(row.metricValue) : null,
    note: row.note,
    matchKey: row.matchKey,
    loggedBy: row.loggedBy,
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

function setupRequiredView(orgId: string | null = null): ScoutingHeatSignalsView {
  return {
    status: "setup_required",
    message: "Select a team workspace to track scouting heat signals.",
    steps: [
      { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
    ],
    orgId,
  };
}

export async function computeScoutingHeatSignalsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ScoutingHeatSignalsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequiredView();

  const entriesResult = await client.query<EntryRow>(
    `SELECT e.id, e.team_key AS "teamKey", e.team_number AS "teamNumber", t.nickname,
            e.observed_on::text AS "observedOn", e.direction, e.metric_value::text AS "metricValue",
            e.note, e.match_key AS "matchKey", e.logged_by AS "loggedBy", e.created_at::text AS "createdAt"
     FROM scouting_heat_signals_entries e
     LEFT JOIN teams_ref t ON t.team_key = e.team_key
     WHERE e.org_id = $1
     ORDER BY e.observed_on ASC, e.created_at ASC`,
    [org.orgId],
  );

  const entries = entriesResult.rows.map(mapEntry);

  const entriesByTeam = new Map<string, HeatSignalEntry[]>();
  for (const entry of entries) {
    const list = entriesByTeam.get(entry.teamKey) ?? [];
    list.push(entry);
    entriesByTeam.set(entry.teamKey, list);
  }

  const teams: TeamHeatSignal[] = [];
  for (const [teamKey, teamEntries] of entriesByTeam) {
    const first = teamEntries[0]!;
    const signal = computeTeamHeatSignal({
      teamKey,
      teamNumber: first.teamNumber,
      nickname: first.nickname,
      entries: teamEntries,
    });
    if (signal) teams.push(signal);
  }
  teams.sort((a, b) => Math.abs(b.heatScore) - Math.abs(a.heatScore));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    teams,
    summary: summarizeHeatSignals(teams, entries.length),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logHeatSignalEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    teamNumber: number;
    observedOn: string;
    direction: HeatDirection;
    metricValue: number | null;
    note: string | null;
    matchKey: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const teamResult = await client.query<{ teamKey: string }>(
    `SELECT team_key AS "teamKey" FROM teams_ref WHERE team_number = $1`,
    [input.teamNumber],
  );
  const teamKey = teamResult.rows[0]?.teamKey;
  if (!teamKey) return { ok: false, error: "Unknown team number — no reference data found." };

  await client.query(
    `INSERT INTO scouting_heat_signals_entries (
       org_id, team_key, team_number, observed_on, direction, metric_value, note, match_key, logged_by
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)`,
    [
      input.orgId,
      teamKey,
      input.teamNumber,
      input.observedOn,
      input.direction,
      input.metricValue,
      input.note,
      input.matchKey,
      input.userId,
    ],
  );
  return { ok: true };
}

export async function deleteHeatSignalEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM scouting_heat_signals_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}
