import type { PoolClient } from "@neondatabase/serverless";
import {
  buildEngagementDigestInsight,
  buildInspectionAdvisorInsight,
  buildKickoffStrategistInsight,
  buildModelAccuracyInsight,
  buildPracticeCoachInsight,
  buildRobotBlueprintInsight,
  buildScheduleRiskInsight,
  buildStockAdvisorInsight,
  buildVideoScoutSummaryInsight,
  type BuiltInsight,
  type InsightRequest,
} from "./ai-insights";
import { loadVaultDocumentCounts } from "./cad-vault/load-vault-coverage";
import { bomCoverage as bomCoverageFor } from "./inventory";
import type { EnrichedSubsystem, RobotSubsystem } from "./robot-blueprint";
import type { HourLog, HourMember } from "./build-hours";
import type { DriverCycle, DriverSession } from "./driver-practice";
import { DEFAULT_WEIGHT_LIMIT_LBS, type InspectionItem, type RobotWeight } from "./inspection";
import type { BomEntry, InventoryItem } from "./inventory";
import type { DesignPriority, ScoringAction } from "./kickoff";
import type { Milestone } from "./season-calendar";
import type { VideoNote, VideoReview } from "./video-review";

/**
 * Reads one AI insight's grounded rows for an org and builds it (lib/ai-insights.ts).
 *
 * Moved out of app/api/ai-insights/route.ts so Ask AI skills read the same rows the insight
 * panels did — one loader, two callers. Read-only; runs on the caller's withRls client.
 */
export async function loadInsight(client: PoolClient, request: InsightRequest): Promise<BuiltInsight> {
  switch (request.kind) {
    case "practice_coach": {
      const [sessions, cycles] = await Promise.all([
        client.query<Omit<DriverSession, "cycles">>(
          `SELECT s.id, s.title, s.event_key AS "eventKey", s.session_date::text AS "sessionDate",
                  s.driver_user_id AS "driverUserId", s.driver_name AS "driverName",
                  s.location, s.goal, s.notes,
                  NULL AS "attendanceEventId", NULL AS "attendanceEventTitle",
                  NULL AS "attendanceOccurredOn",
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

    case "robot_blueprint": {
      const [subsystems, practiceStats, bomItems, bomEntries, failures, maintenance, vaultCounts] = await Promise.all([
        client.query<RobotSubsystem>(
          `SELECT s.id, s.robot_label AS "robotLabel", s.name, s.description, s.status,
                  s.cad_url AS "cadUrl", s.code_ref AS "codeRef", s.priority_id AS "priorityId",
                  p.capability AS "priorityCapability", p.status AS "priorityStatus",
                  s.practice_action AS "practiceAction", s.bom_subsystem AS "bomSubsystem", s.sort_order AS "sortOrder"
           FROM robot_subsystems s
           LEFT JOIN design_priorities p ON p.id = s.priority_id
           WHERE s.org_id = $1 AND s.robot_label = $2
           ORDER BY s.sort_order, s.name`,
          [request.orgId, request.robotLabel],
        ),
        client.query<{ action: string; reps: number; successes: number; avgSeconds: number | null }>(
          `SELECT c.action, count(*)::int AS reps,
                  count(*) FILTER (WHERE c.success)::int AS successes,
                  AVG(c.seconds)::float8 AS "avgSeconds"
           FROM driver_cycles c WHERE c.org_id = $1 GROUP BY c.action`,
          [request.orgId],
        ),
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
        client.query<{ subsystem: string; count: number }>(
          `SELECT lower(subsystem) AS subsystem, count(*)::int AS count
           FROM robot_failures WHERE org_id = $1 AND occurred_at > now() - interval '7 days'
           GROUP BY lower(subsystem)`,
          [request.orgId],
        ),
        client.query<{ subsystem: string; count: number }>(
          `SELECT lower(subsystem) AS subsystem, count(*)::int AS count
           FROM maintenance_items WHERE org_id = $1 AND completed_at IS NULL
           GROUP BY lower(subsystem)`,
          [request.orgId],
        ),
        loadVaultDocumentCounts(client, request.orgId),
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
      const coverage = bomCoverageFor(bomEntries.rows, bomItems.rows);
      const bomBySubsystem = new Map(coverage.map((entry) => [entry.subsystem.toLowerCase(), entry]));
      const failuresBySubsystem = new Map(failures.rows.map((entry) => [entry.subsystem, entry.count]));
      const maintenanceBySubsystem = new Map(maintenance.rows.map((entry) => [entry.subsystem, entry.count]));
      const enriched: EnrichedSubsystem[] = subsystems.rows.map((subsystem) => {
        const bomEntry = bomBySubsystem.get((subsystem.bomSubsystem || subsystem.name).toLowerCase());
        const nameKey = subsystem.name.toLowerCase();
        return {
          ...subsystem,
          vaultDocumentCount: vaultCounts.get(subsystem.id) ?? 0,
          ops: {
            practice: subsystem.practiceAction
              ? (practiceByAction.get(subsystem.practiceAction) ?? { reps: 0, successRate: null, avgSeconds: null })
              : null,
            bom: bomEntry ? { buildable: bomEntry.buildable, shortCount: bomEntry.shortCount } : null,
            failures7d: failuresBySubsystem.get(nameKey) ?? 0,
            openMaintenance: maintenanceBySubsystem.get(nameKey) ?? 0,
          },
        };
      });
      return buildRobotBlueprintInsight(enriched, request.robotLabel);
    }

    case "model_accuracy": {
      const [outcomes, pending] = await Promise.all([
        client.query<{ matchKey: string; pRed: number; winner: "red" | "blue" }>(
          `SELECT DISTINCT ON (p.match_key)
                  p.match_key AS "matchKey", p.p_red::float8 AS "pRed", m.winning_alliance AS winner
           FROM predictions p
           JOIN matches_ref m ON m.match_key = p.match_key
           WHERE p.org_id = $1 AND m.winning_alliance IN ('red', 'blue')
             AND COALESCE(p.model_version, '') !~* 'demo'
             AND COALESCE(p.caveats::text, '') !~* 'demo'
           ORDER BY p.match_key, p.scored_at DESC
           LIMIT 200`,
          [request.orgId],
        ),
        client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM predictions p
           JOIN matches_ref m ON m.match_key = p.match_key
           WHERE p.org_id = $1 AND (m.winning_alliance IS NULL OR m.winning_alliance NOT IN ('red', 'blue'))
             AND COALESCE(p.model_version, '') !~* 'demo'
             AND COALESCE(p.caveats::text, '') !~* 'demo'`,
          [request.orgId],
        ),
      ]);
      return buildModelAccuracyInsight(outcomes.rows, pending.rows[0]?.count ?? 0);
    }
  }
}
