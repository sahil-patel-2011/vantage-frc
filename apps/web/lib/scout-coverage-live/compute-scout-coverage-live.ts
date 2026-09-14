import type { PoolClient } from "@neondatabase/serverless";
import { DEFAULT_THIN_THRESHOLD, matchLabel, rankCoverageGaps, summarizeCoverage } from ".";
import type { CoverageCell, CoverageNudge, CoverageSummary } from "./types";
import { computeScoutingCoverageView } from "../scouting/coverage";

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
  const coverage = await computeScoutingCoverageView(client, {
    userId: input.userId,
    requestedOrg: input.requestedOrg,
    requestedEvent: input.requestedEvent,
    qualsOnly: false,
    windowSize: 200,
  });
  if (coverage.status === "setup_required") {
    return {
      status: "setup_required",
      message: coverage.message,
      steps: coverage.steps,
      orgId: coverage.orgId,
      eventKey: null,
    };
  }

  if (coverage.slots.length === 0) {
    return {
      status: "setup_required",
      message: "No match schedule is synced for this event yet.",
      steps: [
        {
          id: "schedule",
          label: "Sync event schedule",
          detail: "Confirm the event key and wait for the schedule to sync",
          href: "/competition",
        },
      ],
      orgId: coverage.orgId,
      eventKey: coverage.eventKey,
    };
  }

  const [settingsResult, nudgesResult] = await Promise.all([
    client.query<{ thinThreshold: number }>(
      `SELECT thin_threshold AS "thinThreshold" FROM scout_coverage_live_settings WHERE org_id = $1`,
      [coverage.orgId],
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
      [coverage.orgId, coverage.eventKey],
    ),
  ]);

  const thinThreshold =
    settingsResult.rows[0]?.thinThreshold && Number(settingsResult.rows[0].thinThreshold) > 0
      ? Number(settingsResult.rows[0].thinThreshold)
      : DEFAULT_THIN_THRESHOLD;

  const cells: CoverageCell[] = coverage.slots.map((slot) => ({
    matchKey: slot.matchKey,
    matchLabel: matchLabel(slot.compLevel, slot.setNumber ?? 1, slot.matchNumber),
    compLevel: slot.compLevel,
    matchNumber: slot.matchNumber,
    teamKey: slot.teamKey,
    teamNumber: slot.teamNumber ?? 0,
    alliance: slot.alliance ?? "red",
    entryCount: slot.entryCount,
    status:
      slot.entryCount === 0
        ? "zero"
        : slot.entryCount < thinThreshold
          ? "thin"
          : "covered",
  }));
  const summary = summarizeCoverage(cells);
  const gaps = rankCoverageGaps(cells, 15);
  const nudges = nudgesResult.rows.map(mapNudge);

  return {
    status: "live",
    orgId: coverage.orgId,
    teamNumber: coverage.teamNumber,
    eventKey: coverage.eventKey,
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
