import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildDebriefCoachPrompt,
  debriefTakeaways,
  MATCH_DEBRIEF_AI_FEATURE,
  parseMatchDebriefAction,
  summarizeDebriefs,
  type Alliance,
  type MatchResult,
} from "../../../lib/match-debrief";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

/**
 * The optional "coach" action reaches a real upstream model. A bridged turn (a paired device with
 * coverage 'everything') holds the request open for the bridge poll budget
 * (BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS, 240s), so this function declares 300s to keep
 * headroom above it; the adapter's own timeout still fires first and returns a
 * classified error instead of the platform killing the function mid-request.
 *
 * 300s is only honored where the hosting plan's Node function cap reaches it. Below
 * that cap set VANTAGE_BRIDGE_MAX_WAIT_MS so the turn falls through to the team's own
 * keys instead of 504-ing — see docs/AI_BRIDGE.md "Function duration".
 */
export const maxDuration = 300;

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
  return Response.json({ error: error instanceof Error ? error.message : "Match debrief request failed" }, { status });
}

type DebriefRow = {
  id: string; seasonYear: number; eventKey: string; matchLabel: string; alliance: Alliance; result: MatchResult;
  pointsScored: number | null; cycleCount: number | null; drivetrainOk: boolean; mechanismsOk: boolean; autoOk: boolean;
  whatWorked: string; whatBroke: string; actionItems: string; byName: string | null; createdAt: string;
};

const SELECT_COLS = `id, season_year AS "seasonYear", event_key AS "eventKey", match_label AS "matchLabel", alliance, result,
  points_scored AS "pointsScored", cycle_count AS "cycleCount", drivetrain_ok AS "drivetrainOk",
  mechanisms_ok AS "mechanismsOk", auto_ok AS "autoOk", what_worked AS "whatWorked", what_broke AS "whatBroke",
  action_items AS "actionItems"`;

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
      if (!row) return { status: "setup_required" as const, message: "Select a team workspace to log your matches." };

      const debriefs = await client.query<DebriefRow>(
        `SELECT ${SELECT_COLS}, u.name AS "byName", d.created_at::text AS "createdAt"
         FROM match_debriefs d LEFT JOIN users u ON u.id = d.logged_by
         WHERE d.org_id = $1 AND d.season_year = $2 ORDER BY d.created_at DESC`,
        [row.orgId, seasonYear],
      );

      const summary = summarizeDebriefs(debriefs.rows.map((d) => ({ result: d.result, pointsScored: d.pointsScored, actionItems: d.actionItems })));
      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        debriefs: debriefs.rows,
        summary,
        // Deterministic between-matches read — always present, labeled
        // "Computed from your data" in the client. The AI coach is optional.
        takeaways: debriefTakeaways(debriefs.rows),
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(new HttpError(400, "Invalid request body"));

  // Optional metered AI coach over the deterministic takeaways (learning_coach
  // pattern): the computed text always stands; no adapter → setup_required
  // (503) and the client keeps showing it.
  if (body.action === "coach") {
    try {
      const session = await requireSession();
      const orgId = typeof body.orgId === "string" ? body.orgId : "";
      if (!orgId) throw new HttpError(400, "orgId is required");
      const seasonYear = Number.isInteger(Number(body.seasonYear))
        ? Number(body.seasonYear)
        : new Date().getFullYear();

      const expansion = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireMembership(client, orgId, session.user.id);
        const debriefs = await client.query<DebriefRow>(
          `SELECT ${SELECT_COLS}, NULL AS "byName", d.created_at::text AS "createdAt"
           FROM match_debriefs d
           WHERE d.org_id = $1 AND d.season_year = $2 ORDER BY d.created_at DESC LIMIT 40`,
          [orgId, seasonYear],
        );
        const message = buildDebriefCoachPrompt({
          seasonYear,
          debriefs: debriefs.rows,
          takeaways: debriefTakeaways(debriefs.rows),
        });
        if (!message) throw new HttpError(400, "Log at least one match debrief before asking the coach");

        const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
        const adapter = await resolveOrgChatAdapter(client, {
          orgId,
          userId: session.user.id,
          promptCachingEnabled,
          feature: MATCH_DEBRIEF_AI_FEATURE,
          bridgeTransport: createBridgeTransport(),
        });
        const text = await meteredAI({
          client,
          orgId,
          userId: session.user.id,
          feature: MATCH_DEBRIEF_AI_FEATURE,
          requestId: randomUUID(),
          estimatedCostUsd: 0.005,
          estimatedPromptTokens: Math.ceil(message.length / 4),
          estimatedCompletionTokens: 200,
          provider: adapter.provider,
          model: adapter.model,
          metadata: { action: "debrief_coach", seasonYear, debriefCount: debriefs.rows.length },
          invoke: async () => {
            const result = await adapter.complete({ message, context: [], promptCachingEnabled });
            return {
              value: result.text,
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
              costUsd: result.costUsd,
              model: adapter.model,
              provider: adapter.provider,
              cacheReadInputTokens: result.cacheReadInputTokens,
              cacheWriteInputTokens: result.cacheWriteInputTokens,
              uncachedInputTokens: result.uncachedInputTokens,
            };
          },
        });
        return { text, generatedAt: new Date().toISOString(), provider: adapter.provider, model: adapter.model };
      });
      return Response.json(expansion);
    } catch (error) {
      return failMeteredAi(error, "The AI debrief coach is unavailable right now.");
    }
  }

  try {
    const session = await requireSession();
    const action = parseMatchDebriefAction(body);
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      if (action.action === "delete_debrief") {
        const deleted = await client.query(`DELETE FROM match_debriefs WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
        if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this debrief");
        return { ok: true };
      }

      const d = action.action === "create_debrief" ? action : action.patch;
      if (action.action === "create_debrief") {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO match_debriefs (org_id, season_year, event_key, match_label, alliance, result, points_scored,
             cycle_count, drivetrain_ok, mechanisms_ok, auto_ok, what_worked, what_broke, action_items, logged_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [action.orgId, action.seasonYear, d.eventKey, d.matchLabel, d.alliance, d.result, d.pointsScored,
            d.cycleCount, d.drivetrainOk, d.mechanismsOk, d.autoOk, d.whatWorked, d.whatBroke, d.actionItems, userId],
        );
        return { id: inserted.rows[0]!.id };
      }

      const updated = await client.query(
        `UPDATE match_debriefs SET event_key = $1, match_label = $2, alliance = $3, result = $4, points_scored = $5,
           cycle_count = $6, drivetrain_ok = $7, mechanisms_ok = $8, auto_ok = $9, what_worked = $10, what_broke = $11,
           action_items = $12, updated_at = now()
         WHERE id = $13 AND org_id = $14`,
        [d.eventKey, d.matchLabel, d.alliance, d.result, d.pointsScored, d.cycleCount, d.drivetrainOk, d.mechanismsOk,
          d.autoOk, d.whatWorked, d.whatBroke, d.actionItems, action.id, action.orgId],
      );
      if (!updated.rowCount) throw new HttpError(404, "Debrief not found");
      return { ok: true };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
