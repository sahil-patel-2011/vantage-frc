/**
 * Load Pit Command repairs / batteries / queue from real org-scoped rows.
 *
 * Request-path only: parameterized SQL through the PoolClient from withRls.
 * Classification stays in ./board.ts so empty-vs-live flags are fixture-testable
 * without a database.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { BATTERY_READY_RULE } from "../battery-reliability";
import { loadRepeatFailureAlerts, type RepeatFailureAlert } from "../fmea/repeat-failures";
import { loadBatteryFleet } from "../load-battery-fleet";
import {
  assemblePitBoard,
  type PitBatteryRow,
  type PitBoardView,
  type PitNextMatch,
  type PitQueueRow,
  type PitRepairRow,
} from "./board";

export type PitBoardMember = {
  role: string;
  name: string;
  teamNumber: number | null;
};

export type PitBoardPayload = PitBoardView & {
  organization: { name: string; teamNumber: number | null; role: string };
  context: { eventKey: string | null; eventName: string | null };
  repeatAlerts: RepeatFailureAlert[];
  rules: { battery: string; hold: string };
  updatedAt: string;
};

export async function loadPitBoard(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    member: PitBoardMember;
    now?: Date;
  },
): Promise<PitBoardPayload> {
  const now = input.now ?? new Date();
  const [contextQuery, maintenanceQuery, issueQuery, fleet, repeatAlerts] = await Promise.all([
    client.query<{ eventKey: string | null; eventName: string | null }>(
      `SELECT c.active_event_key AS "eventKey",e.name AS "eventName"
       FROM organizations o
       LEFT JOIN org_active_context c ON c.org_id=o.id
       LEFT JOIN events_ref e ON e.event_key=c.active_event_key
       WHERE o.id=$1`,
      [input.orgId],
    ),
    client.query<PitQueueRow>(
      `SELECT id,subsystem,task,due_at::text AS "dueAt"
       FROM maintenance_items
       WHERE org_id=$1 AND completed_at IS NULL
       ORDER BY due_at ASC NULLS LAST,created_at DESC
       LIMIT 50`,
      [input.orgId],
    ),
    client.query<PitRepairRow>(
      `SELECT id,subsystem,severity,symptoms,occurred_at::text AS "occurredAt",
              match_key AS "matchKey",recorded_by AS "recordedBy"
       FROM robot_failures
       WHERE org_id=$1 AND resolved_at IS NULL
       ORDER BY CASE severity WHEN 'safety' THEN 0 WHEN 'disabled' THEN 1 WHEN 'degraded' THEN 2 ELSE 3 END,
                occurred_at DESC
       LIMIT 50`,
      [input.orgId],
    ),
    loadBatteryFleet(client, input.orgId, now),
    loadRepeatFailureAlerts(client, input.orgId, { limit: 8 }),
  ]);

  const context = contextQuery.rows[0] ?? { eventKey: null, eventName: null };
  const teamKey = input.member.teamNumber ? `frc${input.member.teamNumber}` : null;
  const nextMatch: PitNextMatch | null =
    context.eventKey && teamKey
      ? (
          await client.query<PitNextMatch>(
            `SELECT match_key AS "matchKey",comp_level AS "compLevel",
                    match_number AS "matchNumber",
                    COALESCE(predicted_time,event_time)::text AS "scheduledTime"
             FROM matches_ref
             WHERE event_key=$1
               AND (red_alliance->'teamKeys' ? $2 OR blue_alliance->'teamKeys' ? $2)
               AND COALESCE(actual_time,predicted_time,event_time)>now()
             ORDER BY COALESCE(actual_time,predicted_time,event_time)
             LIMIT 1`,
            [context.eventKey, teamKey],
          )
        ).rows[0] ?? null
      : null;

  const batteries: PitBatteryRow[] = fleet.packs.map((pack) => ({
    id: pack.id,
    assetTag: pack.label,
    status: pack.pitStatus,
    measuredAt: pack.measuredAt,
    voltage: pack.voltage,
    resistanceMilliohms: pack.resistanceMilliohms,
    gate: pack.gate,
    health: pack.health.status,
  }));

  const board = assemblePitBoard({
    repairs: issueQuery.rows,
    batteries,
    queue: maintenanceQuery.rows,
    nextMatch,
    now: now.getTime(),
    userId: input.userId,
    memberRole: input.member.role,
    readyBatteries: fleet.readyCount,
    activeBatteries: fleet.activeCount,
  });

  return {
    ...board,
    organization: {
      name: input.member.name,
      teamNumber: input.member.teamNumber,
      role: input.member.role,
    },
    context,
    repeatAlerts: board.status === "live" ? repeatAlerts : [],
    rules: { battery: BATTERY_READY_RULE, hold: "Any unresolved disabled or safety issue" },
    updatedAt: now.toISOString(),
  };
}
