import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseWiringAction, summarizeWiring, type CanBus, type Device } from "../../../lib/wiring";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Wiring request failed" }, { status });
}

type DeviceRow = Device & { breakerAmp: number | null; subsystem: string; notes: string; byName: string | null };

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getFullYear());

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; orgName: string; role: string }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );
      const row = membership.rows[0];
      if (!row) return { status: "setup_required" as const, message: "Select a team workspace to map your wiring." };

      const devices = await client.query<DeviceRow>(
        `SELECT d.id, d.name, d.device_type AS "deviceType", d.can_id AS "canId", d.can_bus AS "canBus",
                d.pdh_port AS "pdhPort", d.breaker_amp AS "breakerAmp", d.subsystem, d.notes, u.name AS "byName"
         FROM robot_devices d LEFT JOIN users u ON u.id = d.created_by
         WHERE d.org_id = $1 AND d.season_year = $2
         ORDER BY d.subsystem, d.can_bus, d.can_id NULLS LAST, d.name`,
        [row.orgId, seasonYear],
      );

      const summary = summarizeWiring(
        devices.rows.map((d) => ({
          id: d.id,
          name: d.name,
          deviceType: d.deviceType,
          canId: d.canId,
          canBus: d.canBus as CanBus,
          pdhPort: d.pdhPort,
          breakerAmp: d.breakerAmp,
        })),
      );

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        devices: devices.rows,
        summary,
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseWiringAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      if (action.action === "delete_device") {
        const deleted = await client.query(`DELETE FROM robot_devices WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
        if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this device");
        return { ok: true };
      }

      const d = action.action === "create_device" ? action : action.patch;
      if (action.action === "create_device") {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO robot_devices (org_id, season_year, name, device_type, can_id, can_bus, pdh_port, breaker_amp, subsystem, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [action.orgId, action.seasonYear, d.name, d.deviceType, d.canId, d.canBus, d.pdhPort, d.breakerAmp, d.subsystem, d.notes, userId],
        );
        return { id: inserted.rows[0]!.id };
      }

      const updated = await client.query(
        `UPDATE robot_devices SET name = $1, device_type = $2, can_id = $3, can_bus = $4, pdh_port = $5,
           breaker_amp = $6, subsystem = $7, notes = $8, updated_at = now()
         WHERE id = $9 AND org_id = $10`,
        [d.name, d.deviceType, d.canId, d.canBus, d.pdhPort, d.breakerAmp, d.subsystem, d.notes, action.id, action.orgId],
      );
      if (!updated.rowCount) throw new HttpError(404, "Device not found");
      return { ok: true };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
