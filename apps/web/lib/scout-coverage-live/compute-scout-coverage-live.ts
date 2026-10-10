import type { PoolClient } from "@neondatabase/serverless";
import { DEFAULT_THIN_THRESHOLD, matchLabel, rankCoverageGaps, summarizePlayedCoverage } from ".";
import type { CoverageCell, CoverageNudge, CoverageSummary } from "./types";
import { REVIEWED_FLAG_HISTORY_LIMIT } from "./types";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { computeScoutingCoverageView, type CoverageScopeSummary } from "../scouting/coverage";
import { loadMissedAssignments, type MissedAssignmentRow } from "../scouting/assignment-accountability-load";
import { scoutEventLabel } from "../scouting/scouting-related";
import { assertScoutingLead } from "@vantage/scouting/permissions";
import { RequestSecurityError } from "../security/request";

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
      eventName: string | null;
      thinThreshold: number;
      canManage: boolean;
      cells: CoverageCell[];
      /** Played matches only: robots scouted vs robots that played. */
      summary: CoverageSummary;
      /**
       * Played vs upcoming, the same split Lineup shows. Optional so an older
       * saved view still renders.
       */
      scope?: CoverageScopeSummary;
      gaps: CoverageCell[];
      nudges: CoverageNudge[];
      /**
       * Assigned but not submitted: results are posted and the assigned scout
       * has no entry for that robot. Optional so an older cached view still renders.
       */
      missed?: MissedAssignmentRow[];
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
    const named = scoutEventLabel({
      eventName: coverage.eventName,
      eventKey: coverage.eventKey,
    });
    const scoutStep: ScoutCoverageLiveSetupStep = {
      id: "scouting",
      label: "Open Scouting",
      detail: "The match schedule is not out yet. You can still type a team and match on Scouting.",
      href: hubHref("/competition", "scouting", coverage.orgId),
    };
    const syncStep: ScoutCoverageLiveSetupStep = {
      id: "schedule",
      label: "Update event data",
      detail: "Matches appear here once an owner or admin updates the event data.",
      href: withOrgHref("/team/data", coverage.orgId),
    };
    return {
      status: "setup_required",
      message: named
        ? `${named} has no match schedule yet.`
        : "This event has no match schedule yet.",
      steps: coverage.canAssign ? [syncStep, scoutStep] : [scoutStep],
      orgId: coverage.orgId,
      eventKey: coverage.eventKey,
    };
  }

  const [settingsResult, nudgesResult, missed] = await Promise.all([
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
       JOIN matches_ref m ON m.match_key = n.match_key AND m.event_key = n.event_key
       LEFT JOIN teams_ref t ON t.team_key = n.team_key
       WHERE n.org_id = $1 AND n.event_key = $2
         AND (n.acknowledged_at IS NULL OR n.id IN (
           SELECT id FROM scout_coverage_live_nudges WHERE org_id=$1 AND event_key=$2 AND acknowledged_at IS NOT NULL
           ORDER BY sent_at DESC,id DESC LIMIT ${REVIEWED_FLAG_HISTORY_LIMIT}
         ))
       ORDER BY (n.acknowledged_at IS NOT NULL),n.sent_at DESC,n.id DESC`,
      [coverage.orgId, coverage.eventKey],
    ),
    loadMissedAssignments(client, { orgId: coverage.orgId, eventKey: coverage.eventKey }),
  ]);

  const thinThreshold =
    settingsResult.rows[0]?.thinThreshold && Number(settingsResult.rows[0].thinThreshold) > 0
      ? Number(settingsResult.rows[0].thinThreshold)
      : DEFAULT_THIN_THRESHOLD;

  const played = new Set(coverage.playedMatchKeys);
  const cells: CoverageCell[] = coverage.slots.map((slot) => ({
    matchKey: slot.matchKey,
    matchLabel: matchLabel(slot.compLevel, slot.setNumber ?? 1, slot.matchNumber),
    compLevel: slot.compLevel,
    matchNumber: slot.matchNumber,
    teamKey: slot.teamKey,
    teamNumber: slot.teamNumber ?? 0,
    alliance: slot.alliance ?? "red",
    entryCount: slot.entryCount,
    played: played.has(slot.matchKey),
    assignmentCount: slot.assignmentCount,
    status:
      slot.entryCount === 0
        ? "zero"
        : slot.entryCount < thinThreshold
          ? "thin"
          : "covered",
  }));
  const summary = summarizePlayedCoverage(cells);
  const gaps = rankCoverageGaps(cells, cells.length);
  const nudges = nudgesResult.rows.map(mapNudge);

  return {
    status: "live",
    orgId: coverage.orgId,
    teamNumber: coverage.teamNumber,
    eventKey: coverage.eventKey,
    eventName: coverage.eventName,
    thinThreshold,
    canManage: coverage.canAssign,
    cells,
    summary,
    scope: coverage.scope,
    gaps,
    nudges,
    missed,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function setThinThreshold(
  client: PoolClient,
  input: { orgId: string; userId: string; thinThreshold: number; expectedThreshold: number },
): Promise<void> {
  await assertScoutingLead(client, input.orgId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`coverage-settings:${input.orgId.toLowerCase()}`]);
  const current = await client.query<{ thinThreshold: number }>('SELECT thin_threshold AS "thinThreshold" FROM scout_coverage_live_settings WHERE org_id=$1::uuid', [input.orgId]);
  if ((current.rows[0]?.thinThreshold ?? DEFAULT_THIN_THRESHOLD) !== input.expectedThreshold) throw new RequestSecurityError(409, "Another lead changed the report target. Your input is retained. Refresh before saving it again.");
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
): Promise<{ id: string; created: boolean }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`coverage-flags:${input.orgId.toLowerCase()}:${input.eventKey}`]);
  const pending = await client.query<{ id: string }>(
    `SELECT id FROM scout_coverage_live_nudges WHERE org_id=$1::uuid AND event_key=$2 AND match_key=$3 AND team_key=$4 AND acknowledged_at IS NULL ORDER BY sent_at DESC LIMIT 1`,
    [input.orgId, input.eventKey, input.matchKey, input.teamKey],
  );
  if (pending.rows[0]) return { id: pending.rows[0].id, created: false };
  const saved = await client.query<{ id: string }>(
    `INSERT INTO scout_coverage_live_nudges (org_id, event_key, match_key, team_key, message, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.orgId, input.eventKey, input.matchKey, input.teamKey, input.message, input.userId],
  );
  if (!saved.rows[0]) throw new Error("Coverage flag could not be confirmed");
  return { id: saved.rows[0].id, created: true };
}

export async function acknowledgeCoverageNudge(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; nudgeId: string },
): Promise<{ acknowledgedAt: string }> {
  await assertScoutingLead(client, input.orgId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`coverage-flags:${input.orgId.toLowerCase()}:${input.eventKey}`]);
  const saved = await client.query<{ acknowledgedAt: string }>(
    `UPDATE scout_coverage_live_nudges
     SET acknowledged_by = COALESCE(acknowledged_by,$1::uuid), acknowledged_at = COALESCE(acknowledged_at,now())
     WHERE id = $2::uuid AND org_id = $3::uuid AND event_key=$4
     RETURNING acknowledged_at::text AS "acknowledgedAt"`,
    [input.userId, input.nudgeId, input.orgId, input.eventKey],
  );
  if (!saved.rows[0]) throw new RequestSecurityError(404, "This flag is no longer available in the selected event.");
  return saved.rows[0];
}
