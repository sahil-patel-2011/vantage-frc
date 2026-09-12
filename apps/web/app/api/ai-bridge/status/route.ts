import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  BRIDGE_ONLINE_WINDOW_MS,
  BRIDGE_CHAT_FEATURES,
} from "@vantage/agent";

export type BridgeDeviceStatus = {
  id: string;
  name: string;
  pairedBy: string;
  pairedByMe: boolean;
  online: boolean;
  lastHeartbeatAt: string | null;
  engines: Record<string, { available?: boolean; version?: string | null; authenticated?: boolean | null }>;
  bridgeVersion: string | null;
  preferWhenOnline: boolean;
  /** 'chat' = interactive features only; 'everything' = all AI platform-wide (0488). */
  coverage: "chat" | "everything";
  /** 'personal' = this pairer's turns only (0655 Your Claude Code). */
  scope: "team" | "personal";
  jobsServed: number;
  canManage: boolean;
};

async function requireSessionOrg(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: Response.json({ error: "Authentication required" }, { status: 401 }) };
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return { error: Response.json({ error: "orgId is required" }, { status: 400 }) };
  return { session, orgId };
}

/** Team bridge status: devices, engines, recent job outcomes. RLS scopes everything. */
export async function GET(request: Request) {
  const gate = await requireSessionOrg(request);
  if ("error" in gate) return gate.error;
  const { session, orgId } = gate;
  try {
    return await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, session.user.id],
      );
      if (!role.rows[0]) return Response.json({ error: "Organization access denied" }, { status: 403 });
      const isAdmin = role.rows[0].role === "owner" || role.rows[0].role === "admin";
      const devices = await client.query<{
        id: string;
        name: string;
        pairedBy: string;
        lastHeartbeatAt: Date | null;
        engines: BridgeDeviceStatus["engines"] | null;
        bridgeVersion: string | null;
        preferWhenOnline: boolean;
        coverage: string | null;
        scope: string | null;
        jobsServed: number;
      }>(
        // coverage / scope via to_jsonb: older databases answer NULL, not an error.
        `SELECT id, name, paired_by AS "pairedBy", last_heartbeat_at AS "lastHeartbeatAt",
                engines, bridge_version AS "bridgeVersion",
                prefer_when_online AS "preferWhenOnline",
                (to_jsonb(ai_bridge_devices) ->> 'coverage') AS coverage,
                (to_jsonb(ai_bridge_devices) ->> 'scope') AS scope,
                jobs_served AS "jobsServed"
           FROM ai_bridge_devices
          WHERE org_id = $1::uuid AND revoked_at IS NULL
          ORDER BY created_at DESC`,
        [orgId],
      );
      const jobs = await client.query<{ state: string; count: string; lastAt: Date | null }>(
        `SELECT state, COUNT(*)::text AS count, MAX(created_at) AS "lastAt"
           FROM ai_bridge_jobs
          WHERE org_id = $1::uuid AND created_at > now() - interval '7 days'
          GROUP BY state`,
        [orgId],
      );
      return Response.json({
        devices: devices.rows
          .filter((row) => row.scope !== "personal" || row.pairedBy === session.user.id)
          .map(
            (row): BridgeDeviceStatus => ({
              id: row.id,
              name: row.name,
              pairedBy: row.pairedBy,
              pairedByMe: row.pairedBy === session.user.id,
              online:
                Boolean(row.lastHeartbeatAt) &&
                Date.now() - new Date(row.lastHeartbeatAt!).getTime() < BRIDGE_ONLINE_WINDOW_MS,
              lastHeartbeatAt: row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : null,
              engines: row.engines ?? {},
              bridgeVersion: row.bridgeVersion,
              preferWhenOnline: row.preferWhenOnline,
              coverage: row.coverage === "everything" ? "everything" : "chat",
              scope: row.scope === "personal" ? "personal" : "team",
              jobsServed: row.jobsServed,
              canManage: isAdmin || row.pairedBy === session.user.id,
            }),
          ),
        jobStats: jobs.rows.map((row) => ({
          state: row.state,
          count: Number(row.count),
          lastAt: row.lastAt ? new Date(row.lastAt).toISOString() : null,
        })),
        bridgeFeatures: [...BRIDGE_CHAT_FEATURES],
      });
    });
  } catch (error) {
    // Pre-0486 database: the bridge tables don't exist yet — honest setup state.
    if (error instanceof Error && /ai_bridge_devices/.test(error.message)) {
      return Response.json({ devices: [], jobStats: [], bridgeFeatures: [...BRIDGE_CHAT_FEATURES], setupRequired: true });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Bridge status failed" },
      { status: 400 },
    );
  }
}

/**
 * Coverage and revoke change who answers for the whole team: 'everything' redirects every
 * AI feature — chat, finance, grants, CAD prompts — onto one member's personal machine and
 * personal subscription, and revoke takes it all back. Record both in the org's existing
 * audit stream (`membership_audit_events`, the same table `/api/organizations/audit` reads
 * back), following the insert used for other sensitive org changes in packages/core.
 *
 * The savepoint mirrors `emitAccessRequestNotification` in packages/core/src/membership.ts:
 * the audit insert is RLS-restricted to owners/admins, but the device's own pairer may be
 * neither, and their device change must not be rolled back by a denied audit write. The
 * caller is told (`audited`) rather than left to assume a trail exists.
 */
async function auditBridgeChange(
  client: PoolClient,
  input: { orgId: string; actorUserId: string; action: string; metadata: Record<string, unknown> },
): Promise<boolean> {
  await client.query("SAVEPOINT ai_bridge_audit");
  try {
    await client.query(
      `INSERT INTO membership_audit_events(org_id, actor_user_id, action, metadata)
       VALUES($1::uuid, $2::uuid, $3, $4::jsonb)`,
      [input.orgId, input.actorUserId, input.action, JSON.stringify(input.metadata)],
    );
    await client.query("RELEASE SAVEPOINT ai_bridge_audit");
    return true;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT ai_bridge_audit");
    return false;
  }
}

/** Toggle prefer_when_online or revoke a device. RLS update policy limits this to the pairer / owner / admin. */
export async function PATCH(request: Request) {
  const gate = await requireSessionOrg(request);
  if ("error" in gate) return gate.error;
  const { session, orgId } = gate;
  try {
    const body = (await request.json()) as {
      deviceId?: string;
      preferWhenOnline?: boolean;
      coverage?: string;
      scope?: string;
      revoke?: boolean;
    };
    if (!body.deviceId) throw new Error("deviceId is required");
    if (body.coverage !== undefined && body.coverage !== "chat" && body.coverage !== "everything") {
      throw new Error("coverage must be 'chat' or 'everything'");
    }
    if (body.scope !== undefined && body.scope !== "team" && body.scope !== "personal") {
      throw new Error("scope must be 'team' or 'personal'");
    }
    return await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = body.revoke
        ? await client.query<{ name: string }>(
            `UPDATE ai_bridge_devices SET revoked_at = now(), status = 'paired', updated_at = now()
              WHERE id = $1::uuid AND revoked_at IS NULL
              RETURNING name`,
            [body.deviceId],
          )
        : body.coverage !== undefined
          ? await client.query<{ name: string }>(
              `UPDATE ai_bridge_devices SET coverage = $2, updated_at = now()
                WHERE id = $1::uuid AND revoked_at IS NULL
                RETURNING name`,
              [body.deviceId, body.coverage],
            )
          : body.scope !== undefined
            ? await client.query<{ name: string }>(
                // Personal is only the pairer's own computer. Admins cannot point
                // someone else's machine at Your Claude Code.
                `UPDATE ai_bridge_devices SET scope = $2, updated_at = now()
                  WHERE id = $1::uuid AND revoked_at IS NULL
                    AND ($2 <> 'personal' OR paired_by = $3::uuid)
                  RETURNING name`,
                [body.deviceId, body.scope, session.user.id],
              )
            : await client.query<{ name: string }>(
                `UPDATE ai_bridge_devices SET prefer_when_online = $2, updated_at = now()
                  WHERE id = $1::uuid AND revoked_at IS NULL
                  RETURNING name`,
                [body.deviceId, Boolean(body.preferWhenOnline)],
              );
      if (!result.rowCount) {
        return Response.json(
          { error: "Device not found, or only the pairer / an owner / admin can change it." },
          { status: 403 },
        );
      }
      // prefer_when_online only reorders fallbacks, so it stays out of the audit stream.
      const audited = body.revoke
        ? await auditBridgeChange(client, {
            orgId,
            actorUserId: session.user.id,
            action: "ai_bridge.device.revoked",
            metadata: { deviceId: body.deviceId, deviceName: result.rows[0]?.name ?? null },
          })
        : body.coverage !== undefined
          ? await auditBridgeChange(client, {
              orgId,
              actorUserId: session.user.id,
              action: "ai_bridge.coverage.changed",
              metadata: {
                deviceId: body.deviceId,
                deviceName: result.rows[0]?.name ?? null,
                coverage: body.coverage,
              },
            })
          : body.scope !== undefined
            ? await auditBridgeChange(client, {
                orgId,
                actorUserId: session.user.id,
                action: "ai_bridge.scope.changed",
                metadata: {
                  deviceId: body.deviceId,
                  deviceName: result.rows[0]?.name ?? null,
                  scope: body.scope,
                },
              })
            : null;
      return Response.json({ success: true, ...(audited === null ? {} : { audited }) });
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bridge update failed" },
      { status: 400 },
    );
  }
}
