import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEFAULT_WEIGHT_LIMIT_LBS,
  INSPECTION_TEMPLATE,
  parseInspectionAction,
  type InspectionItem,
  type InspectionView,
  type RobotWeight,
} from "../../../lib/inspection";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
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

const isAdmin = (role: string) => role === "owner" || role === "admin";

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Inspection request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        orgName: string;
        teamNumber: number | null;
        role: string;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Select a team workspace to run inspection prep.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null },
        } satisfies InspectionView;
      }

      const [items, weights, settings] = await Promise.all([
        client.query<InspectionItem>(
          `SELECT i.id, i.robot_label AS "robotLabel", i.category, i.requirement, i.status, i.note,
                  i.is_custom AS "isCustom", i.sort_order AS "sortOrder",
                  cb.name AS "checkedByName", i.checked_at::text AS "checkedAt"
           FROM inspection_items i
           LEFT JOIN users cb ON cb.id = i.checked_by
           WHERE i.org_id = $1
           ORDER BY i.robot_label, i.category, i.sort_order`,
          [row.orgId],
        ),
        client.query<RobotWeight>(
          `SELECT w.id, w.robot_label AS "robotLabel", w.total_lbs::float8 AS "totalLbs", w.config, w.note,
                  w.weighed_at::text AS "weighedAt", u.name AS "recordedByName"
           FROM robot_weights w
           LEFT JOIN users u ON u.id = w.recorded_by
           WHERE w.org_id = $1
           ORDER BY w.weighed_at DESC
           LIMIT 100`,
          [row.orgId],
        ),
        client.query<{ weightLimitLbs: number }>(
          `SELECT weight_limit_lbs::float8 AS "weightLimitLbs" FROM inspection_settings WHERE org_id = $1`,
          [row.orgId],
        ),
      ]);

      return {
        status: "ready",
        context: { orgId: row.orgId, orgName: row.orgName, teamNumber: row.teamNumber, role: row.role },
        items: items.rows,
        weights: weights.rows,
        weightLimitLbs: settings.rows[0]?.weightLimitLbs ?? DEFAULT_WEIGHT_LIMIT_LBS,
      } satisfies InspectionView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseInspectionAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      const role = await membershipRole(client, action.orgId, userId);

      switch (action.action) {
        case "seed_checklist": {
          // Insert template items that are not already present for this robot.
          const existing = await client.query<{ requirement: string }>(
            `SELECT requirement FROM inspection_items WHERE org_id = $1 AND robot_label = $2`,
            [action.orgId, action.robotLabel],
          );
          const present = new Set(existing.rows.map((row) => row.requirement));
          let sort = 0;
          let added = 0;
          for (const group of INSPECTION_TEMPLATE) {
            for (const requirement of group.items) {
              sort += 1;
              if (present.has(requirement)) continue;
              await client.query(
                `INSERT INTO inspection_items (org_id, robot_label, category, requirement, sort_order, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [action.orgId, action.robotLabel, group.category, requirement, sort, userId],
              );
              added += 1;
            }
          }
          return { added };
        }

        case "reset_checklist": {
          // Set every item on this robot back to pending (keeps custom items).
          const updated = await client.query(
            `UPDATE inspection_items
             SET status = 'pending', note = '', checked_by = NULL, checked_at = NULL, updated_at = now()
             WHERE org_id = $1 AND robot_label = $2`,
            [action.orgId, action.robotLabel],
          );
          return { reset: updated.rowCount ?? 0 };
        }

        case "add_item": {
          const next = await client.query<{ next: number }>(
            `SELECT COALESCE(MAX(sort_order) + 1, 1000) AS next FROM inspection_items
             WHERE org_id = $1 AND robot_label = $2 AND category = $3`,
            [action.orgId, action.robotLabel, action.category],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO inspection_items (org_id, robot_label, category, requirement, is_custom, sort_order, created_by)
             VALUES ($1, $2, $3, $4, true, $5, $6) RETURNING id`,
            [action.orgId, action.robotLabel, action.category, action.requirement, next.rows[0]?.next ?? 1000, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "set_status": {
          const updated = await client.query(
            `UPDATE inspection_items
             SET status = $3, note = COALESCE($4, note), checked_by = $5, checked_at = now(), updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId, action.status, action.note, userId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Checklist item not found");
          return { ok: true };
        }

        case "delete_item": {
          const deleted = await client.query(`DELETE FROM inspection_items WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this item");
          return { ok: true };
        }

        case "log_weight": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO robot_weights (org_id, robot_label, total_lbs, config, note, recorded_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [action.orgId, action.robotLabel, action.totalLbs, action.config, action.note, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "delete_weight": {
          const deleted = await client.query(`DELETE FROM robot_weights WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this weigh-in");
          return { ok: true };
        }

        case "set_weight_limit": {
          if (!isAdmin(role)) throw new HttpError(403, "Owner/admin access required");
          await client.query(
            `INSERT INTO inspection_settings (org_id, weight_limit_lbs, updated_by, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (org_id) DO UPDATE SET
               weight_limit_lbs = excluded.weight_limit_lbs, updated_by = excluded.updated_by, updated_at = now()`,
            [action.orgId, action.weightLimitLbs, userId],
          );
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported inspection action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
