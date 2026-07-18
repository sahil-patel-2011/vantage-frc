import type { PoolClient } from "@neondatabase/serverless";
import { assertOrgAuthentication, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies, headers } from "next/headers";
import { ensureBatteryRetireFailure } from "../../../lib/battery-fmea";
import { BATTERY_READY_RULE, pitStatusToPack } from "../../../lib/battery-reliability";
import { loadBatteryFleet } from "../../../lib/load-battery-fleet";
import { loadRepeatFailureAlerts } from "../../../lib/fmea/repeat-failures";
import { computeReleaseGate, parsePitAction } from "../../../lib/pit-operations";

export const dynamic = "force-dynamic";
class PitHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const failure = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "Pit Command request failed" },
    { status: error instanceof PitHttpError ? error.status : 400 },
  );

async function currentSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new PitHttpError(401, "Authentication required");
  return session;
}

async function access(
  client: PoolClient,
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>,
  orgId: string,
) {
  const result = await client.query<{ role: string; name: string; teamNumber: number | null }>(
    `SELECT m.role,o.name,o.team_number AS "teamNumber" FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.org_id=$1 AND m.user_id=$2`,
    [orgId, session.user.id],
  );
  const member = result.rows[0];
  if (!member) throw new PitHttpError(403, "Organization access denied");
  try {
    await assertOrgAuthentication(client, {
      userId: session.user.id,
      orgId,
      sessionId: session.session.id,
      authMethod: String((session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown"),
      rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value,
    });
  } catch (error) {
    throw new PitHttpError(403, error instanceof Error ? error.message : "Organization authentication policy denied access");
  }
  return member;
}

export async function GET(request: Request) {
  try {
    const session = await currentSession();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new PitHttpError(400, "orgId is required");
    const payload = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await access(client, session, orgId);
      const [contextQuery, maintenanceQuery, issueQuery, fleet, repeatAlerts] = await Promise.all([
        client.query<{ eventKey: string | null; eventName: string | null }>(
          `SELECT c.active_event_key AS "eventKey",e.name AS "eventName" FROM organizations o LEFT JOIN org_active_context c ON c.org_id=o.id LEFT JOIN events_ref e ON e.event_key=c.active_event_key WHERE o.id=$1`,
          [orgId],
        ),
        client.query<{ id: string; subsystem: string; task: string; dueAt: string | null }>(
          `SELECT id,subsystem,task,due_at::text AS "dueAt" FROM maintenance_items WHERE org_id=$1 AND completed_at IS NULL ORDER BY due_at ASC NULLS LAST,created_at DESC LIMIT 50`,
          [orgId],
        ),
        client.query<{
          id: string;
          subsystem: string;
          severity: string;
          symptoms: string;
          occurredAt: string;
          matchKey: string | null;
          recordedBy: string;
        }>(
          `SELECT id,subsystem,severity,symptoms,occurred_at::text AS "occurredAt",match_key AS "matchKey",recorded_by AS "recordedBy" FROM robot_failures WHERE org_id=$1 AND resolved_at IS NULL ORDER BY CASE severity WHEN 'safety' THEN 0 WHEN 'disabled' THEN 1 WHEN 'degraded' THEN 2 ELSE 3 END,occurred_at DESC LIMIT 50`,
          [orgId],
        ),
        loadBatteryFleet(client, orgId),
        loadRepeatFailureAlerts(client, orgId, { limit: 8 }),
      ]);
      const context = contextQuery.rows[0] ?? { eventKey: null, eventName: null };
      const teamKey = member.teamNumber ? `frc${member.teamNumber}` : null;
      const nextMatch =
        context.eventKey && teamKey
          ? (
              await client.query<{
                matchKey: string;
                compLevel: string;
                matchNumber: number;
                scheduledTime: string | null;
              }>(
                `SELECT match_key AS "matchKey",comp_level AS "compLevel",match_number AS "matchNumber",COALESCE(predicted_time,event_time)::text AS "scheduledTime" FROM matches_ref WHERE event_key=$1 AND (red_alliance->'teamKeys' ? $2 OR blue_alliance->'teamKeys' ? $2) AND COALESCE(actual_time,predicted_time,event_time)>now() ORDER BY COALESCE(actual_time,predicted_time,event_time) LIMIT 1`,
                [context.eventKey, teamKey],
              )
            ).rows[0] ?? null
          : null;
      const batteries = fleet.packs.map((pack) => ({
        id: pack.id,
        assetTag: pack.label,
        status: pack.pitStatus,
        measuredAt: pack.measuredAt,
        voltage: pack.voltage,
        resistanceMilliohms: pack.resistanceMilliohms,
        gate: pack.gate,
        health: pack.health.status,
      }));
      const now = Date.now();
      const overdueMaintenance = maintenanceQuery.rows.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < now).length;
      const safetyIssues = issueQuery.rows.filter((item) => item.severity === "safety").length;
      const disabledIssues = issueQuery.rows.filter((item) => item.severity === "disabled").length;
      return {
        organization: { name: member.name, teamNumber: member.teamNumber, role: member.role },
        context,
        nextMatch,
        gate: computeReleaseGate({
          safetyIssues,
          disabledIssues,
          overdueMaintenance,
          readyBatteries: fleet.readyCount,
          activeBatteries: fleet.activeCount,
        }),
        summary: {
          openIssues: issueQuery.rowCount,
          overdueMaintenance,
          readyBatteries: fleet.readyCount,
          activeBatteries: fleet.activeCount,
          repeatFailureSubsystems: repeatAlerts.length,
        },
        issues: issueQuery.rows.map((issue) => ({
          ...issue,
          canResolve: issue.recordedBy === session.user.id || ["owner", "admin"].includes(member.role),
        })),
        repeatAlerts,
        maintenance: maintenanceQuery.rows,
        batteries,
        rules: { battery: BATTERY_READY_RULE, hold: "Any unresolved disabled or safety issue" },
        updatedAt: new Date().toISOString(),
      };
    });
    return Response.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await currentSession();
    const action = parsePitAction(await request.json());
    const result = await withRls({ userId: session.user.id, orgId: action.orgId }, async (client) => {
      await access(client, session, action.orgId);
      if (action.action === "report_issue") {
        const row = await client.query<{ id: string }>(
          `INSERT INTO robot_failures(org_id,event_key,match_key,subsystem,severity,symptoms,occurred_at,recorded_by) VALUES($1,(SELECT active_event_key FROM org_active_context WHERE org_id=$1),$2,$3,$4,$5,now(),$6) RETURNING id`,
          [action.orgId, action.matchKey, action.subsystem, action.severity, action.symptoms, session.user.id],
        );
        return { success: true, id: row.rows[0]!.id };
      }
      if (action.action === "resolve_issue") {
        const row = await client.query(
          `UPDATE robot_failures SET resolution=$1,resolved_at=now(),resolved_by=$2 WHERE id=$3 AND org_id=$4 AND resolved_at IS NULL`,
          [action.resolution, session.user.id, action.id, action.orgId],
        );
        if (!row.rowCount) throw new PitHttpError(404, "Open issue not found");
        return { success: true };
      }
      if (action.action === "log_battery") {
        const pack = await client.query<{ id: string }>(
          `INSERT INTO battery_packs(org_id,label,status,notes,created_by)
           VALUES ($1,$2,'active','', $3)
           ON CONFLICT (org_id, label) DO UPDATE SET updated_at = now()
           RETURNING id`,
          [action.orgId, action.assetTag, session.user.id],
        );
        const packId = pack.rows[0]!.id;
        const noteParts = ["Logged from Pit Command"];
        if (action.chargerCycles != null) noteParts.push(`charger cycles ${action.chargerCycles}`);
        await client.query(
          `INSERT INTO battery_logs(org_id,battery_id,kind,resting_voltage,internal_resistance_mohm,note,logged_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            action.orgId,
            packId,
            action.resistanceMilliohms != null ? "resistance_test" : "note",
            action.voltage,
            action.resistanceMilliohms,
            noteParts.join(" · "),
            session.user.id,
          ],
        );
        if (action.resistanceMilliohms != null) {
          await ensureBatteryRetireFailure(client, {
            orgId: action.orgId,
            userId: session.user.id,
            label: action.assetTag,
            resistanceMohm: action.resistanceMilliohms,
          });
        }
        return { success: true, id: packId };
      }
      if (action.action === "battery_status") {
        const row = await client.query(
          `UPDATE battery_packs SET status=$1, updated_at=now() WHERE id=$2 AND org_id=$3`,
          [pitStatusToPack(action.status), action.id, action.orgId],
        );
        if (!row.rowCount) throw new PitHttpError(404, "Battery not found");
        await client.query(
          `INSERT INTO battery_logs(org_id,battery_id,kind,note,logged_by) VALUES ($1,$2,$3,$4,$5)`,
          [
            action.orgId,
            action.id,
            action.status === "retired" ? "retire" : action.status === "active" ? "return_to_service" : "note",
            `Pit status set to ${action.status}`,
            session.user.id,
          ],
        );
        return { success: true };
      }
      if (action.action === "add_maintenance") {
        const row = await client.query<{ id: string }>(
          `INSERT INTO maintenance_items(org_id,subsystem,task,due_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [action.orgId, action.subsystem, action.task, action.dueAt, session.user.id],
        );
        return { success: true, id: row.rows[0]!.id };
      }
      const row = await client.query(
        `UPDATE maintenance_items SET completed_at=now(),completed_by=$1,updated_at=now() WHERE id=$2 AND org_id=$3 AND completed_at IS NULL`,
        [session.user.id, action.id, action.orgId],
      );
      if (!row.rowCount) throw new PitHttpError(404, "Open maintenance item not found");
      return { success: true };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
