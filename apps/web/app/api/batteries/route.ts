import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  batteryHealth,
  cartSlot,
  competitionReadiness,
  monthsBetween,
  parseBatteryAction,
  rankForRotation,
  type BatteryStatus,
  type HealthStatus,
} from "../../../lib/battery";
import { ensureBatteryRetireFailure } from "../../../lib/battery-fmea";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function membershipRole(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
  return row.rows[0]!.role;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Battery request failed" }, { status });
}

type PackRow = {
  id: string;
  label: string;
  brand: string | null;
  nominalAh: number | null;
  purchaseDate: string | null;
  status: BatteryStatus;
  assignment: string;
  notes: string;
  createdAt: string;
  cycleCount: number;
  lastInternalResistanceMohm: number | null;
  lastRestingVoltage: number | null;
  lastMeasuredAt: string | null;
  lastUsedAt: string | null;
  lastChargedAt: string | null;
  lastTestedAt: string | null;
};

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; orgName: string; teamNumber: number | null; role: string }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );
      const row = membership.rows[0];
      if (!row) {
        return { status: "setup_required" as const, message: "Select a team to track batteries.", context: { orgId: null } };
      }

      const [packs, logs] = await Promise.all([
        client.query<PackRow>(
          `SELECT p.id, p.label, p.brand, p.nominal_ah::float8 AS "nominalAh", p.purchase_date::text AS "purchaseDate",
                  p.status, p.assignment, p.notes, p.created_at::text AS "createdAt",
                  COALESCE(agg.cycle_count, 0) AS "cycleCount",
                  agg.last_resistance::float8 AS "lastInternalResistanceMohm",
                  agg.last_voltage::float8 AS "lastRestingVoltage",
                  agg.last_measured_at::text AS "lastMeasuredAt",
                  agg.last_used_at::text AS "lastUsedAt", agg.last_charged_at::text AS "lastChargedAt",
                  agg.last_tested_at::text AS "lastTestedAt"
           FROM battery_packs p
           LEFT JOIN LATERAL (
             SELECT
               count(*) FILTER (WHERE kind IN ('match', 'practice'))::int AS cycle_count,
               (SELECT internal_resistance_mohm FROM battery_logs l WHERE l.battery_id = p.id AND l.internal_resistance_mohm IS NOT NULL ORDER BY l.created_at DESC LIMIT 1) AS last_resistance,
               (SELECT resting_voltage FROM battery_logs l WHERE l.battery_id = p.id AND l.resting_voltage IS NOT NULL ORDER BY l.created_at DESC LIMIT 1) AS last_voltage,
               max(created_at) FILTER (WHERE resting_voltage IS NOT NULL OR internal_resistance_mohm IS NOT NULL) AS last_measured_at,
               max(created_at) FILTER (WHERE kind IN ('match', 'practice')) AS last_used_at,
               max(created_at) FILTER (WHERE kind IN ('charge', 'storage_charge')) AS last_charged_at,
               max(created_at) FILTER (
                 WHERE kind NOT IN ('charge', 'storage_charge')
                   AND (resting_voltage IS NOT NULL OR internal_resistance_mohm IS NOT NULL)
               ) AS last_tested_at
             FROM battery_logs l WHERE l.battery_id = p.id
           ) agg ON true
           WHERE p.org_id = $1
           ORDER BY p.status, p.label`,
          [row.orgId],
        ),
        client.query(
          `SELECT l.id, l.battery_id AS "batteryId", b.label AS "batteryLabel", l.kind,
                  l.resting_voltage::float8 AS "restingVoltage", l.internal_resistance_mohm::float8 AS "internalResistanceMohm",
                  l.match_key AS "matchKey", l.note, u.name AS "byName", l.created_at::text AS "createdAt"
           FROM battery_logs l
           JOIN battery_packs b ON b.id = l.battery_id
           LEFT JOIN users u ON u.id = l.logged_by
           WHERE l.org_id = $1 ORDER BY l.created_at DESC LIMIT 80`,
          [row.orgId],
        ),
      ]);

      const now = new Date();
      const enriched = packs.rows.map((pack) => {
        const ageMonths = monthsBetween(pack.purchaseDate, now);
        const health = batteryHealth({
          internalResistanceMohm: pack.lastInternalResistanceMohm,
          restingVoltage: pack.lastRestingVoltage,
          cycleCount: pack.cycleCount,
          ageMonths,
        });
        const readiness = competitionReadiness({
          status: pack.status,
          health,
          lastMeasuredAt: pack.lastMeasuredAt,
          lastRestingVoltage: pack.lastRestingVoltage,
          lastInternalResistanceMohm: pack.lastInternalResistanceMohm,
          now,
        });
        const slot = cartSlot({
          status: pack.status,
          lastChargedAt: pack.lastChargedAt,
          lastUsedAt: pack.lastUsedAt,
          lastTestedAt: pack.lastTestedAt,
          nowIso: now.toISOString(),
        });
        return { ...pack, ageMonths, health, readiness, cartSlot: slot };
      });
      const rotation = rankForRotation(enriched).slice(0, 5).map((pack) => pack.id);

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, teamNumber: row.teamNumber, role: row.role },
        packs: enriched,
        logs: logs.rows,
        rotation,
        summary: {
          active: enriched.filter((p) => p.status === "active").length,
          competitionReady: enriched.filter((p) => p.readiness.ready).length,
          needAttention: enriched.filter((p) => p.status === "active" && (!p.readiness.ready || p.health.status !== "good")).length,
          retired: enriched.filter((p) => p.status === "retired").length,
          cartReady: enriched.filter((p) => p.cartSlot.kind === "ready").length,
          cartCooling: enriched.filter((p) => p.cartSlot.kind === "cooling").length,
        },
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

const STATUS_LOG_KIND: Record<BatteryStatus, string> = { retired: "retire", active: "return_to_service", quarantine: "note" };

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseBatteryAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await membershipRole(client, action.orgId, userId);

      switch (action.action) {
        case "create_pack": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO battery_packs (org_id, label, brand, nominal_ah, purchase_date, assignment, notes, created_by)
             VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8) RETURNING id`,
            [action.orgId, action.label, action.brand, action.nominalAh, action.purchaseDate, action.assignment, action.notes, userId],
          );
          const id = inserted.rows[0]!.id;
          if (action.initialResistanceMohm != null || action.initialVoltage != null) {
            await client.query(
              `INSERT INTO battery_logs (org_id, battery_id, kind, resting_voltage, internal_resistance_mohm, note, logged_by)
               VALUES ($1, $2, 'resistance_test', $3, $4, 'Initial reading', $5)`,
              [action.orgId, id, action.initialVoltage, action.initialResistanceMohm, userId],
            );
          }
          return { id };
        }

        case "update_pack": {
          const sets: string[] = [];
          const values: unknown[] = [];
          const add = (col: string, val: unknown, cast = "") => {
            values.push(val);
            sets.push(`${col} = $${values.length}${cast}`);
          };
          if (action.patch.label !== undefined) add("label", action.patch.label);
          if (action.patch.brand !== undefined) add("brand", action.patch.brand);
          if (action.patch.nominalAh !== undefined) add("nominal_ah", action.patch.nominalAh);
          if (action.patch.purchaseDate !== undefined) add("purchase_date", action.patch.purchaseDate, "::date");
          if (action.patch.assignment !== undefined) add("assignment", action.patch.assignment);
          if (action.patch.notes !== undefined) add("notes", action.patch.notes);
          const updated = await client.query(
            `UPDATE battery_packs SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Battery not found");
          return { ok: true };
        }

        case "assign_pack": {
          const updated = await client.query(
            `UPDATE battery_packs SET assignment = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
            [action.assignment, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Battery not found");
          return { ok: true };
        }

        case "set_status": {
          const updated = await client.query(
            `UPDATE battery_packs SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
            [action.status, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Battery not found");
          await client.query(
            `INSERT INTO battery_logs (org_id, battery_id, kind, note, logged_by) VALUES ($1, $2, $3, $4, $5)`,
            [action.orgId, action.id, STATUS_LOG_KIND[action.status], action.note || `Status set to ${action.status}`, userId],
          );
          return { ok: true };
        }

        case "delete_pack": {
          const deleted = await client.query(`DELETE FROM battery_packs WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this battery");
          return { ok: true };
        }

        case "log_event": {
          const pack = await client.query<{ label: string }>(
            `SELECT label FROM battery_packs WHERE id = $1 AND org_id = $2`,
            [action.batteryId, action.orgId],
          );
          if (!pack.rowCount) throw new HttpError(404, "Battery not found");
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO battery_logs (org_id, battery_id, kind, resting_voltage, internal_resistance_mohm, match_key, note, logged_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [action.orgId, action.batteryId, action.kind, action.restingVoltage, action.internalResistanceMohm, action.matchKey, action.note, userId],
          );
          if (action.internalResistanceMohm != null) {
            await ensureBatteryRetireFailure(client, {
              orgId: action.orgId,
              userId,
              label: pack.rows[0]!.label,
              resistanceMohm: action.internalResistanceMohm,
            });
          }
          return { id: inserted.rows[0]!.id };
        }

        default:
          throw new HttpError(400, "Unsupported battery action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

export type { HealthStatus };
