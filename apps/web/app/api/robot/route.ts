import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { bomCoverage, type BomEntry, type InventoryItem } from "../../../lib/inventory";
import { loadVaultDocumentCounts } from "../../../lib/cad-vault/load-vault-coverage";
import {
  parseBlueprintAction,
  SEED_SUBSYSTEMS,
  type BlueprintView,
  type EnrichedSubsystem,
  type PriorityOption,
  type RobotSubsystem,
  type SubsystemPatch,
} from "../../../lib/robot-blueprint";

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

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Blueprint request failed" }, { status });
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
        seasonYear: number;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
                COALESCE(
                  (SELECT e.year FROM org_active_context c JOIN events_ref e ON e.event_key = c.active_event_key WHERE c.org_id = m.org_id),
                  EXTRACT(YEAR FROM now())::int
                ) AS "seasonYear"
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
          message: "Select a team workspace to open the robot blueprint.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, seasonYear: new Date().getFullYear() },
        } satisfies BlueprintView;
      }

      const [subsystems, priorities, practiceStats, bomItems, bomEntries, failures, maintenance, vaultCounts] = await Promise.all([
        client.query<RobotSubsystem>(
          `SELECT s.id, s.robot_label AS "robotLabel", s.name, s.description, s.status,
                  s.cad_url AS "cadUrl", s.code_ref AS "codeRef", s.priority_id AS "priorityId",
                  p.capability AS "priorityCapability", p.status AS "priorityStatus",
                  s.practice_action AS "practiceAction", s.bom_subsystem AS "bomSubsystem", s.sort_order AS "sortOrder"
           FROM robot_subsystems s
           LEFT JOIN design_priorities p ON p.id = s.priority_id
           WHERE s.org_id = $1
           ORDER BY s.robot_label, s.sort_order, s.name`,
          [row.orgId],
        ),
        client.query<PriorityOption>(
          `SELECT id, capability, weight, status FROM design_priorities
           WHERE org_id = $1 AND season_year = $2
           ORDER BY weight DESC, capability`,
          [row.orgId, row.seasonYear],
        ),
        client.query<{ action: string; reps: number; successes: number; avgSeconds: number | null }>(
          `SELECT c.action, count(*)::int AS reps,
                  count(*) FILTER (WHERE c.success)::int AS successes,
                  AVG(c.seconds)::float8 AS "avgSeconds"
           FROM driver_cycles c
           WHERE c.org_id = $1
           GROUP BY c.action`,
          [row.orgId],
        ),
        client.query<InventoryItem>(
          `SELECT i.id, i.name, i.category, i.part_number AS "partNumber", i.vendor, i.unit,
                  i.quantity::float8 AS quantity, i.min_quantity::float8 AS "minQuantity",
                  i.unit_cost::float8 AS "unitCost", i.location_id AS "locationId", NULL AS "locationName",
                  i.subsystem, i.notes, i.archived, i.updated_at::text AS "updatedAt"
           FROM inventory_items i WHERE i.org_id = $1`,
          [row.orgId],
        ),
        client.query<BomEntry>(
          `SELECT id, subsystem, item_id AS "itemId", quantity_needed::float8 AS "quantityNeeded", notes
           FROM bom_entries WHERE org_id = $1`,
          [row.orgId],
        ),
        client.query<{ subsystem: string; count: number }>(
          `SELECT lower(subsystem) AS subsystem, count(*)::int AS count
           FROM robot_failures
           WHERE org_id = $1 AND occurred_at > now() - interval '7 days'
           GROUP BY lower(subsystem)`,
          [row.orgId],
        ),
        client.query<{ subsystem: string; count: number }>(
          `SELECT lower(subsystem) AS subsystem, count(*)::int AS count
           FROM maintenance_items
           WHERE org_id = $1 AND completed_at IS NULL
           GROUP BY lower(subsystem)`,
          [row.orgId],
        ),
        loadVaultDocumentCounts(client, row.orgId),
      ]);

      const practiceByAction = new Map(
        practiceStats.rows.map((stat) => [
          stat.action,
          {
            reps: stat.reps,
            successRate: stat.reps ? Math.round((stat.successes / stat.reps) * 100) : null,
            avgSeconds: stat.avgSeconds == null ? null : Math.round(stat.avgSeconds * 100) / 100,
          },
        ]),
      );
      const coverage = bomCoverage(bomEntries.rows, bomItems.rows);
      const bomBySubsystem = new Map(coverage.map((entry) => [entry.subsystem.toLowerCase(), entry]));
      const failuresBySubsystem = new Map(failures.rows.map((entry) => [entry.subsystem, entry.count]));
      const maintenanceBySubsystem = new Map(maintenance.rows.map((entry) => [entry.subsystem, entry.count]));

      const enriched: EnrichedSubsystem[] = subsystems.rows.map((subsystem) => {
        const bomKey = (subsystem.bomSubsystem || subsystem.name).toLowerCase();
        const bomEntry = bomBySubsystem.get(bomKey);
        const nameKey = subsystem.name.toLowerCase();
        return {
          ...subsystem,
          vaultDocumentCount: vaultCounts.get(subsystem.id) ?? 0,
          ops: {
            practice: subsystem.practiceAction ? (practiceByAction.get(subsystem.practiceAction) ?? { reps: 0, successRate: null, avgSeconds: null }) : null,
            bom: bomEntry ? { buildable: bomEntry.buildable, shortCount: bomEntry.shortCount } : null,
            failures7d: failuresBySubsystem.get(nameKey) ?? 0,
            openMaintenance: maintenanceBySubsystem.get(nameKey) ?? 0,
          },
        };
      });

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
          seasonYear: row.seasonYear,
        },
        subsystems: enriched,
        priorities: priorities.rows,
      } satisfies BlueprintView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseBlueprintAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "seed_subsystems": {
          const existing = await client.query<{ name: string }>(
            `SELECT name FROM robot_subsystems WHERE org_id = $1 AND robot_label = $2`,
            [action.orgId, action.robotLabel],
          );
          const present = new Set(existing.rows.map((row) => row.name.toLowerCase()));
          let sort = existing.rowCount ?? 0;
          let added = 0;
          for (const seed of SEED_SUBSYSTEMS) {
            if (present.has(seed.name.toLowerCase())) continue;
            await client.query(
              `INSERT INTO robot_subsystems (org_id, robot_label, name, description, sort_order, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [action.orgId, action.robotLabel, seed.name, seed.description, sort, userId],
            );
            sort += 1;
            added += 1;
          }
          return { added };
        }

        case "add_subsystem": {
          const next = await client.query<{ next: number }>(
            `SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM robot_subsystems
             WHERE org_id = $1 AND robot_label = $2`,
            [action.orgId, action.robotLabel],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO robot_subsystems (org_id, robot_label, name, description, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [action.orgId, action.robotLabel, action.name, action.description, next.rows[0]?.next ?? 0, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_subsystem": {
          const { clause, values } = buildSubsystemUpdate(action.patch);
          const updated = await client.query(
            `UPDATE robot_subsystems SET ${clause}, updated_at = now()
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Subsystem not found");
          return { ok: true };
        }

        case "delete_subsystem": {
          const deleted = await client.query(`DELETE FROM robot_subsystems WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this subsystem");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported blueprint action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

function buildSubsystemUpdate(patch: SubsystemPatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if (patch.name !== undefined) add("name", patch.name);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.cadUrl !== undefined) add("cad_url", patch.cadUrl);
  if (patch.codeRef !== undefined) add("code_ref", patch.codeRef);
  if (patch.priorityId !== undefined) add("priority_id", patch.priorityId, "::uuid");
  if (patch.practiceAction !== undefined) add("practice_action", patch.practiceAction);
  if (patch.bomSubsystem !== undefined) add("bom_subsystem", patch.bomSubsystem);
  if (patch.sortOrder !== undefined) add("sort_order", patch.sortOrder);
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}
