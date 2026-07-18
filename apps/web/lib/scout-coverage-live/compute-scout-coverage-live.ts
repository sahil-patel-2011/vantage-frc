import type { PoolClient } from "@neondatabase/serverless";
import { DEFAULT_THIN_THRESHOLD, buildCoverageCells, matchLabel, rankCoverageGaps, summarizeCoverage, teamKeysFromAlliance } from ".";
import type { CoverageCell, CoverageNudge, CoverageSummary } from "./types";
import { resolveScoutOrg } from "../scout-org-access";

export type ScoutCoverageLiveSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutCoverageLiveView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutCoverageLiveSetupStep[];
      orgId: string | null;
      eventKey: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string;
      thinThreshold: number;
      cells: CoverageCell[];
      summary: CoverageSummary;
      gaps: CoverageCell[];
      nudges: CoverageNudge[];
      computedAt: string;
    };

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

async function resolveEventKey(
  client: PoolClient,
  orgId: string,
  requestedEvent: string | null,
): Promise<string | null> {
  if (requestedEvent) return requestedEvent;
  const row = await client.query<{ eventKey: string }>(
    `SELECT c.active_event_key AS "eventKey"
     FROM org_active_context c
     WHERE c.org_id = $1 AND c.active_event_key IS NOT NULL`,
    [orgId],
  );
  return row.rows[0]?.eventKey ?? null;
}

type MatchRow = {
  matchKey: string;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  redAlliance: { team_keys?: string[] } | string[] | null;
  blueAlliance: { team_keys?: string[] } | string[] | null;
};

type NudgeRow = {
  id: string;
  matchKey: string;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  teamKey: string;
  teamNumber: number;
  message: string;
  sentBy: string;
  sentAt: string;
  acknowledgedAt: string | null;
};

function mapNudge(row: NudgeRow): CoverageNudge {
  return {
    id: row.id,
    matchKey: row.matchKey,
    matchLabel: matchLabel(row.compLevel, row.setNumber, row.matchNumber),
    teamKey: row.teamKey,
    teamNumber: Number(row.teamNumber) || 0,
    message: row.message,
    sentBy: row.sentBy,
    sentAt: row.sentAt,
    acknowledged: row.acknowledgedAt != null,
    acknowledgedAt: row.acknowledgedAt,
  };
}

export async function computeScoutCoverageLiveView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; requestedEvent?: string | null },
): Promise<ScoutCoverageLiveView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to see live scouting coverage.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      eventKey: null,
    };
  }

  const eventKey = await resolveEventKey(client, org.orgId, input.requestedEvent ?? null);
  if (!eventKey) {
    return {
      status: "setup_required",
      message: "Set an active competition event to watch live scouting coverage.",
      steps: [
        {
          id: "active-event",
          label: "Set active event",
          detail: "Pick the event your team is competing at right now",
          href: "/competition",
        },
      ],
      orgId: org.orgId,
      eventKey: null,
    };
  }

  const matchesResult = await client.query<MatchRow>(
    `SELECT match_key AS "matchKey", comp_level AS "compLevel", set_number AS "setNumber",
            match_number AS "matchNumber", red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
     FROM matches_ref
     WHERE event_key = $1
     ORDER BY comp_level, set_number, match_number
     LIMIT 200`,
    [eventKey],
  );

  if (matchesResult.rows.length === 0) {
    return {
      status: "setup_required",
      message: "No match schedule is synced for this event yet.",
      steps: [
        {
          id: "schedule",
          label: "Sync event schedule",
          detail: "Confirm the event key and wait for the schedule to sync from TBA",
          href: "/competition",
        },
      ],
      orgId: org.orgId,
      eventKey,
    };
  }

  const matches = matchesResult.rows.map((row) => ({
    matchKey: row.matchKey,
    compLevel: row.compLevel,
    setNumber: Number(row.setNumber) || 0,
    matchNumber: Number(row.matchNumber) || 0,
    redTeamKeys: teamKeysFromAlliance(row.redAlliance),
    blueTeamKeys: teamKeysFromAlliance(row.blueAlliance),
  }));

  const allTeamKeys = Array.from(new Set(matches.flatMap((m) => [...m.redTeamKeys, ...m.blueTeamKeys])));

  const [settingsResult, teamsResult, entriesResult, nudgesResult] = await Promise.all([
    client.query<{ thinThreshold: number }>(
      `SELECT thin_threshold AS "thinThreshold" FROM scout_coverage_live_settings WHERE org_id = $1`,
      [org.orgId],
    ),
    allTeamKeys.length
      ? client.query<{ teamKey: string; teamNumber: number }>(
          `SELECT team_key AS "teamKey", team_number AS "teamNumber" FROM teams_ref WHERE team_key = ANY($1::text[])`,
          [allTeamKeys],
        )
      : Promise.resolve({ rows: [] as Array<{ teamKey: string; teamNumber: number }> }),
    client.query<{ matchKey: string; teamKey: string; entryCount: string }>(
      `SELECT match_key AS "matchKey", team_key AS "teamKey", count(*)::int AS "entryCount"
       FROM match_scout_entries
       WHERE org_id = $1 AND event_key = $2
       GROUP BY match_key, team_key`,
      [org.orgId, eventKey],
    ),
    client.query<NudgeRow>(
      `SELECT n.id, n.match_key AS "matchKey", m.comp_level AS "compLevel", m.set_number AS "setNumber",
              m.match_number AS "matchNumber", n.team_key AS "teamKey", t.team_number AS "teamNumber",
              n.message, n.sent_by AS "sentBy", n.sent_at::text AS "sentAt",
              n.acknowledged_at::text AS "acknowledgedAt"
       FROM scout_coverage_live_nudges n
       JOIN matches_ref m ON m.match_key = n.match_key
       LEFT JOIN teams_ref t ON t.team_key = n.team_key
       WHERE n.org_id = $1 AND n.event_key = $2
       ORDER BY n.sent_at DESC
       LIMIT 50`,
      [org.orgId, eventKey],
    ),
  ]);

  const thinThreshold =
    settingsResult.rows[0]?.thinThreshold && Number(settingsResult.rows[0].thinThreshold) > 0
      ? Number(settingsResult.rows[0].thinThreshold)
      : DEFAULT_THIN_THRESHOLD;

  const teamNumbers = new Map(teamsResult.rows.map((r) => [r.teamKey, Number(r.teamNumber)]));
  const entryCounts = new Map(entriesResult.rows.map((r) => [`${r.matchKey}::${r.teamKey}`, Number(r.entryCount)]));

  const cells = buildCoverageCells({ matches, entryCounts, teamNumbers, thinThreshold });
  const summary = summarizeCoverage(cells);
  const gaps = rankCoverageGaps(cells, 15);
  const nudges = nudgesResult.rows.map(mapNudge);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey,
    thinThreshold,
    cells,
    summary,
    gaps,
    nudges,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function setThinThreshold(
  client: PoolClient,
  input: { orgId: string; userId: string; thinThreshold: number },
): Promise<void> {
  await client.query(
    `INSERT INTO scout_coverage_live_settings (org_id, thin_threshold, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id) DO UPDATE SET
       thin_threshold = EXCLUDED.thin_threshold,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [input.orgId, input.thinThreshold, input.userId],
  );
}

export async function sendCoverageNudge(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; matchKey: string; teamKey: string; message: string },
): Promise<void> {
  await client.query(
    `INSERT INTO scout_coverage_live_nudges (org_id, event_key, match_key, team_key, message, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.orgId, input.eventKey, input.matchKey, input.teamKey, input.message, input.userId],
  );
}

export async function acknowledgeCoverageNudge(
  client: PoolClient,
  input: { orgId: string; userId: string; nudgeId: string },
): Promise<void> {
  await client.query(
    `UPDATE scout_coverage_live_nudges
     SET acknowledged_by = $1, acknowledged_at = now()
     WHERE id = $2 AND org_id = $3`,
    [input.userId, input.nudgeId, input.orgId],
  );
}
