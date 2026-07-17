import type { PoolClient } from "@neondatabase/serverless";
import { AIOrchestrator, type ChatAdapter } from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildEngagementDigestInsight,
  buildInspectionAdvisorInsight,
  buildKickoffStrategistInsight,
  buildModelAccuracyInsight,
  buildPracticeCoachInsight,
  buildScheduleRiskInsight,
  buildStockAdvisorInsight,
  buildVideoScoutSummaryInsight,
  INSIGHT_CAPABILITY,
  parseInsightRequest,
  type BuiltInsight,
  type InsightRequest,
} from "../../../lib/ai-insights";
import type { HourLog, HourMember } from "../../../lib/build-hours";
import type { DriverCycle, DriverSession } from "../../../lib/driver-practice";
import { DEFAULT_WEIGHT_LIMIT_LBS, type InspectionItem, type RobotWeight } from "../../../lib/inspection";
import type { BomEntry, InventoryItem } from "../../../lib/inventory";
import type { DesignPriority, ScoringAction } from "../../../lib/kickoff";
import type { Milestone } from "../../../lib/season-calendar";
import type { VideoNote, VideoReview } from "../../../lib/video-review";

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

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Insight request failed" }, { status });
}

/**
 * Deterministic local provider (dev + zero-config default), mirroring
 * LocalSummaryProvider: the analysis text is derived entirely from org data by
 * the pure builders; the orchestrator still meters, records provenance, and
 * writes the ai_runs ledger. Swapping in a routed platform model only changes
 * this adapter.
 */
function localInsightAdapter(built: BuiltInsight): ChatAdapter {
  return {
    provider: "local",
    model: "vantage-local-insight-v1",
    complete: async () => ({
      text: built.localText,
      promptTokens:
        Math.ceil(built.message.length / 4) +
        built.sources.reduce((sum, source) => sum + Math.ceil(source.content.length / 4), 0),
      completionTokens: Math.ceil(built.localText.length / 4),
      costUsd: 0,
    }),
  };
}

async function loadInsight(client: PoolClient, request: InsightRequest): Promise<BuiltInsight> {
  switch (request.kind) {
    case "practice_coach": {
      const [sessions, cycles] = await Promise.all([
        client.query<Omit<DriverSession, "cycles">>(
          `SELECT s.id, s.title, s.event_key AS "eventKey", s.session_date::text AS "sessionDate",
                  s.driver_user_id AS "driverUserId", s.driver_name AS "driverName",
                  s.location, s.goal, s.notes,
                  NULL AS "attendanceEventId", NULL AS "attendanceEventTitle",
                  NULL AS "buildTaskId", NULL AS "buildTaskTitle",
                  s.created_at::text AS "createdAt", s.updated_at::text AS "updatedAt"
           FROM driver_sessions s WHERE s.org_id = $1
           ORDER BY s.session_date DESC, s.created_at DESC LIMIT 40`,
          [request.orgId],
        ),
        client.query<DriverCycle>(
          `SELECT c.id, c.session_id AS "sessionId", c.action, c.seconds::float8 AS seconds, c.success,
                  c.note, c.rep_index AS "repIndex", c.created_at::text AS "createdAt"
           FROM driver_cycles c WHERE c.org_id = $1
           ORDER BY c.session_id, c.rep_index`,
          [request.orgId],
        ),
      ]);
      const bySession = new Map<string, DriverCycle[]>();
      for (const cycle of cycles.rows) {
        const list = bySession.get(cycle.sessionId) ?? [];
        list.push(cycle);
        bySession.set(cycle.sessionId, list);
      }
      return buildPracticeCoachInsight(
        sessions.rows.map((session) => ({ ...session, cycles: bySession.get(session.id) ?? [] })),
      );
    }

    case "inspection_advisor": {
      const [items, weights, settings] = await Promise.all([
        client.query<InspectionItem>(
          `SELECT i.id, i.robot_label AS "robotLabel", i.category, i.requirement, i.status, i.note,
                  i.is_custom AS "isCustom", i.sort_order AS "sortOrder",
                  NULL AS "checkedByName", i.checked_at::text AS "checkedAt"
           FROM inspection_items i WHERE i.org_id = $1 AND i.robot_label = $2
           ORDER BY i.category, i.sort_order`,
          [request.orgId, request.robotLabel],
        ),
        client.query<RobotWeight>(
          `SELECT w.id, w.robot_label AS "robotLabel", w.total_lbs::float8 AS "totalLbs", w.config, w.note,
                  w.weighed_at::text AS "weighedAt", NULL AS "recordedByName"
           FROM robot_weights w WHERE w.org_id = $1 AND w.robot_label = $2
           ORDER BY w.weighed_at DESC LIMIT 20`,
          [request.orgId, request.robotLabel],
        ),
        client.query<{ weightLimitLbs: number }>(
          `SELECT weight_limit_lbs::float8 AS "weightLimitLbs" FROM inspection_settings WHERE org_id = $1`,
          [request.orgId],
        ),
      ]);
      return buildInspectionAdvisorInsight({
        items: items.rows,
        weights: weights.rows,
        weightLimitLbs: settings.rows[0]?.weightLimitLbs ?? DEFAULT_WEIGHT_LIMIT_LBS,
        robotLabel: request.robotLabel,
      });
    }

    case "stock_advisor": {
      const [items, bom] = await Promise.all([
        client.query<InventoryItem>(
          `SELECT i.id, i.name, i.category, i.part_number AS "partNumber", i.vendor, i.unit,
                  i.quantity::float8 AS quantity, i.min_quantity::float8 AS "minQuantity",
                  i.unit_cost::float8 AS "unitCost", i.location_id AS "locationId", NULL AS "locationName",
                  i.subsystem, i.notes, i.archived, i.updated_at::text AS "updatedAt"
           FROM inventory_items i WHERE i.org_id = $1`,
          [request.orgId],
        ),
        client.query<BomEntry>(
          `SELECT id, subsystem, item_id AS "itemId", quantity_needed::float8 AS "quantityNeeded", notes
           FROM bom_entries WHERE org_id = $1`,
          [request.orgId],
        ),
      ]);
      return buildStockAdvisorInsight({ items: items.rows, bom: bom.rows });
    }

    case "kickoff_strategist": {
      const seasonRow = await client.query<{ year: number }>(
        `SELECT COALESCE(
           (SELECT e.year FROM org_active_context c JOIN events_ref e ON e.event_key = c.active_event_key WHERE c.org_id = $1),
           EXTRACT(YEAR FROM now())::int
         ) AS year`,
        [request.orgId],
      );
      const seasonYear = seasonRow.rows[0]?.year ?? new Date().getFullYear();
      const [actions, priorities] = await Promise.all([
        client.query<ScoringAction>(
          `SELECT id, season_year AS "seasonYear", label, phase, points::float8 AS points,
                  est_seconds::float8 AS "estSeconds", notes, sort_order AS "sortOrder"
           FROM game_scoring_actions WHERE org_id = $1 AND season_year = $2
           ORDER BY sort_order`,
          [request.orgId, seasonYear],
        ),
        client.query<DesignPriority>(
          `SELECT id, season_year AS "seasonYear", capability, rationale, weight,
                  status, linked_action_id AS "linkedActionId"
           FROM design_priorities WHERE org_id = $1 AND season_year = $2
           ORDER BY weight DESC`,
          [request.orgId, seasonYear],
        ),
      ]);
      return buildKickoffStrategistInsight({ actions: actions.rows, priorities: priorities.rows, seasonYear });
    }

    case "schedule_risk": {
      const milestones = await client.query<Milestone>(
        `SELECT id, title, kind, starts_on::text AS "startsOn", ends_on::text AS "endsOn", notes,
                done, done_at::text AS "doneAt", NULL AS "doneByName", NULL AS "createdByName"
         FROM season_milestones WHERE org_id = $1
         ORDER BY starts_on`,
        [request.orgId],
      );
      return buildScheduleRiskInsight(milestones.rows);
    }

    case "video_scout_summary": {
      const [reviews, notes] = await Promise.all([
        client.query<Omit<VideoReview, "notes">>(
          `SELECT id, title, url, video_id AS "videoId", match_key AS "matchKey", team_key AS "teamKey",
                  notes AS summary, NULL AS "createdByName", updated_at::text AS "updatedAt"
           FROM video_reviews WHERE org_id = $1
           ORDER BY updated_at DESC LIMIT 30`,
          [request.orgId],
        ),
        client.query<VideoNote>(
          `SELECT id, review_id AS "reviewId", at_seconds AS "atSeconds", tag, body,
                  NULL AS "createdByName", created_at::text AS "createdAt"
           FROM video_notes WHERE org_id = $1
           ORDER BY review_id, at_seconds`,
          [request.orgId],
        ),
      ]);
      const byReview = new Map<string, VideoNote[]>();
      for (const note of notes.rows) {
        const list = byReview.get(note.reviewId) ?? [];
        list.push(note);
        byReview.set(note.reviewId, list);
      }
      return buildVideoScoutSummaryInsight(
        reviews.rows.map((row) => ({ ...row, notes: byReview.get(row.id) ?? [] })),
      );
    }

    case "engagement_digest": {
      const [records, members, policy] = await Promise.all([
        client.query<HourLog>(
          `SELECT r.id, r.user_id AS "userId", u.name AS "userName", r.kind,
                  r.clock_in::text AS "clockIn", r.clock_out::text AS "clockOut", r.note,
                  NULL AS "closedByName"
           FROM hour_logs r JOIN users u ON u.id = r.user_id
           WHERE r.org_id = $1
           ORDER BY r.clock_in DESC LIMIT 2000`,
          [request.orgId],
        ),
        client.query<HourMember>(
          `SELECT u.id AS "userId", u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = $1`,
          [request.orgId],
        ),
        client.query<{ seasonGoalHours: number }>(
          `SELECT season_goal_hours::float8 AS "seasonGoalHours" FROM hour_policies WHERE org_id = $1`,
          [request.orgId],
        ),
      ]);
      return buildEngagementDigestInsight({
        records: records.rows,
        members: members.rows,
        goalHours: policy.rows[0]?.seasonGoalHours ?? 0,
      });
    }

    case "model_accuracy": {
      const [outcomes, pending] = await Promise.all([
        client.query<{ matchKey: string; pRed: number; winner: "red" | "blue" }>(
          `SELECT DISTINCT ON (p.match_key)
                  p.match_key AS "matchKey", p.p_red::float8 AS "pRed", m.winning_alliance AS winner
           FROM predictions p
           JOIN matches_ref m ON m.match_key = p.match_key
           WHERE p.org_id = $1 AND m.winning_alliance IN ('red', 'blue')
           ORDER BY p.match_key, p.scored_at DESC
           LIMIT 200`,
          [request.orgId],
        ),
        client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM predictions p
           JOIN matches_ref m ON m.match_key = p.match_key
           WHERE p.org_id = $1 AND (m.winning_alliance IS NULL OR m.winning_alliance NOT IN ('red', 'blue'))`,
          [request.orgId],
        ),
      ]);
      return buildModelAccuracyInsight(outcomes.rows, pending.rows[0]?.count ?? 0);
    }
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const parsed = parseInsightRequest(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: parsed.orgId }, async (client) => {
      const membership = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [
        parsed.orgId,
        userId,
      ]);
      if (!membership.rowCount) throw new HttpError(403, "Organization membership required");

      const built = await loadInsight(client, parsed);
      const run = await new AIOrchestrator(client).run({
        orgId: parsed.orgId,
        userId,
        requestId: crypto.randomUUID(),
        capability: INSIGHT_CAPABILITY[parsed.kind],
        privacyScope: "team",
        message: built.message,
        adapter: localInsightAdapter(built),
        contextSources: built.sources,
      });
      return {
        text: run.text,
        runId: run.runId,
        provider: run.provider,
        model: run.model,
        sourceCount: run.contextSources.length,
      };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
