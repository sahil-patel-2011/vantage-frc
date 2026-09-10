import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  parseKickoffAction,
  type DesignPriority,
  type DesignPriorityPatch,
  type KickoffView,
  type RuleNote,
  type RuleNotePatch,
  type ScoringAction,
  type ScoringActionPatch,
} from "../../../lib/kickoff";

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
  return Response.json({ error: error instanceof Error ? error.message : "Kickoff request failed" }, { status });
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
          message: "Choose your team to run kickoff game analysis.",
          context: {
            orgId: null,
            orgName: null,
            teamNumber: null,
            role: null,
            defaultSeasonYear: new Date().getFullYear(),
          },
        } satisfies KickoffView;
      }

      const season = await client.query<{ year: number }>(
        `SELECT COALESCE(
           (SELECT e.year FROM org_active_context c JOIN events_ref e ON e.event_key = c.active_event_key WHERE c.org_id = $1),
           EXTRACT(YEAR FROM now())::int
         ) AS year`,
        [row.orgId],
      );
      const defaultSeasonYear = season.rows[0]?.year ?? new Date().getFullYear();

      const [actions, priorities, ruleNotes] = await Promise.all([
        client.query<ScoringAction>(
          `SELECT a.id, a.season_year AS "seasonYear", a.label, a.phase, a.points::float8 AS points,
                  a.est_seconds::float8 AS "estSeconds", a.notes, a.sort_order AS "sortOrder"
           FROM game_scoring_actions a
           WHERE a.org_id = $1
           ORDER BY a.season_year DESC, a.sort_order, a.created_at
           LIMIT 500`,
          [row.orgId],
        ),
        client.query<DesignPriority>(
          `SELECT p.id, p.season_year AS "seasonYear", p.capability, p.rationale, p.weight, p.status,
                  p.linked_action_id AS "linkedActionId"
           FROM design_priorities p
           WHERE p.org_id = $1
           ORDER BY p.season_year DESC, p.weight DESC, p.created_at
           LIMIT 500`,
          [row.orgId],
        ),
        client.query<RuleNote>(
          `SELECT n.id, n.season_year AS "seasonYear", n.question, n.answer, n.rule_ref AS "ruleRef", n.status
           FROM kickoff_rule_notes n
           WHERE n.org_id = $1
           ORDER BY n.season_year DESC, n.created_at DESC
           LIMIT 500`,
          [row.orgId],
        ),
      ]);

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
          defaultSeasonYear,
        },
        actions: actions.rows,
        priorities: priorities.rows,
        ruleNotes: ruleNotes.rows,
      } satisfies KickoffView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseKickoffAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "add_action": {
          const next = await client.query<{ next: number }>(
            `SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM game_scoring_actions
             WHERE org_id = $1 AND season_year = $2`,
            [action.orgId, action.seasonYear],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO game_scoring_actions (org_id, season_year, label, phase, points, est_seconds, notes, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              action.orgId,
              action.seasonYear,
              action.label,
              action.phase,
              action.points,
              action.estSeconds,
              action.notes,
              next.rows[0]?.next ?? 0,
              userId,
            ],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_action": {
          const { clause, values } = buildActionUpdate(action.patch);
          const updated = await client.query(
            `UPDATE game_scoring_actions SET ${clause}, updated_at = now()
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Scoring action not found");
          return { ok: true };
        }

        case "delete_action": {
          const deleted = await client.query(`DELETE FROM game_scoring_actions WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Scoring action not found");
          return { ok: true };
        }

        case "add_priority": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO design_priorities (org_id, season_year, capability, rationale, weight, linked_action_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [action.orgId, action.seasonYear, action.capability, action.rationale, action.weight, action.linkedActionId, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_priority": {
          const { clause, values } = buildPriorityUpdate(action.patch);
          const updated = await client.query(
            `UPDATE design_priorities SET ${clause}, updated_at = now()
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Design priority not found");
          return { ok: true };
        }

        case "delete_priority": {
          const deleted = await client.query(`DELETE FROM design_priorities WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Design priority not found");
          return { ok: true };
        }

        case "add_rule_note": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO kickoff_rule_notes (org_id, season_year, question, rule_ref, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [action.orgId, action.seasonYear, action.question, action.ruleRef, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_rule_note": {
          const { clause, values } = buildRuleNoteUpdate(action.patch);
          const updated = await client.query(
            `UPDATE kickoff_rule_notes SET ${clause}, updated_at = now()
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Rule note not found");
          return { ok: true };
        }

        case "delete_rule_note": {
          const deleted = await client.query(`DELETE FROM kickoff_rule_notes WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Rule note not found");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported kickoff action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

function buildActionUpdate(patch: ScoringActionPatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.label !== undefined) add("label", patch.label);
  if (patch.phase !== undefined) add("phase", patch.phase);
  if (patch.points !== undefined) add("points", patch.points);
  if (patch.estSeconds !== undefined) add("est_seconds", patch.estSeconds);
  if (patch.notes !== undefined) add("notes", patch.notes);
  if (patch.sortOrder !== undefined) add("sort_order", patch.sortOrder);
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}

function buildPriorityUpdate(patch: DesignPriorityPatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if (patch.capability !== undefined) add("capability", patch.capability);
  if (patch.rationale !== undefined) add("rationale", patch.rationale);
  if (patch.weight !== undefined) add("weight", patch.weight);
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.linkedActionId !== undefined) add("linked_action_id", patch.linkedActionId, "::uuid");
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}

function buildRuleNoteUpdate(patch: RuleNotePatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.question !== undefined) add("question", patch.question);
  if (patch.answer !== undefined) add("answer", patch.answer);
  if (patch.ruleRef !== undefined) add("rule_ref", patch.ruleRef);
  if (patch.status !== undefined) add("status", patch.status);
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}
