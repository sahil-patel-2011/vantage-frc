import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { createBridgeTransport } from "../../../../lib/ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildCoachPrompt,
  cleanCoachParagraph,
  LEARNING_COACH_FEATURE,
} from "../../../../lib/learning/coach-prompt";
import {
  canReadOrgCalls,
  parseLearningSurface,
  roleTier,
  type LearningSurface,
} from "../../../../lib/learning/learning-mode";
import {
  parseLearningPrediction,
  summarizeAccuracyTrend,
  type Closeness,
  type PastCall,
} from "../../../../lib/learning/predictions";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";

/**
 * The learning-coach paragraph can reach a real upstream model. A bridged turn (a paired device with
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

const TREND_WINDOW = 5;
const ORG_FEED_LIMIT = 25;

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

type MembershipRow = { orgId: string; orgName: string; role: string };

async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<MembershipRow | null> {
  const result = await client.query<MembershipRow>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
       FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
      LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "Learning prediction request failed" },
    { status },
  );
}

type CallRow = {
  id: string;
  surface: LearningSurface;
  predicted: Record<string, unknown>;
  actual: Record<string, unknown>;
  closeness: Closeness | null;
  skipped: boolean;
  createdAt: string;
  byName: string | null;
};

/**
 * GET /api/learning/predictions?surface=gearbox
 * The signed-in member's own recent calls on one surface plus their accuracy
 * trend. Mentors (owner/admin) additionally get the org feed, because the point
 * of the ledger is spotting who is struggling.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const surface = parseLearningSurface(url.searchParams.get("surface"));
    const requestedOrg = url.searchParams.get("orgId");
    const wantsOrgFeed = url.searchParams.get("scope") === "org";

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      if (!membership) {
        return {
          status: "setup_required" as const,
          message: "Join a team workspace to keep a record of your calls.",
        };
      }
      const tier = roleTier(membership.role);
      const mentor = canReadOrgCalls(membership.role);

      const mine = await client.query<CallRow>(
        `SELECT p.id, p.surface, p.predicted, p.actual, p.closeness, p.skipped,
                p.created_at AS "createdAt", u.name AS "byName"
           FROM learning_predictions p JOIN users u ON u.id = p.user_id
          WHERE p.org_id = $1::uuid AND p.user_id = $2::uuid AND p.surface = $3
          ORDER BY p.created_at DESC
          LIMIT $4`,
        [membership.orgId, session.user.id, surface, TREND_WINDOW],
      );

      let orgCalls: CallRow[] = [];
      if (mentor && wantsOrgFeed) {
        const feed = await client.query<CallRow>(
          `SELECT p.id, p.surface, p.predicted, p.actual, p.closeness, p.skipped,
                  p.created_at AS "createdAt", u.name AS "byName"
             FROM learning_predictions p JOIN users u ON u.id = p.user_id
            WHERE p.org_id = $1::uuid AND p.surface = $2
            ORDER BY p.created_at DESC
            LIMIT $3`,
          [membership.orgId, surface, ORG_FEED_LIMIT],
        );
        orgCalls = feed.rows;
      }

      const trend = summarizeAccuracyTrend(
        mine.rows.map<PastCall>((row) => ({
          closeness: row.closeness,
          skipped: row.skipped,
          createdAt: String(row.createdAt),
        })),
        TREND_WINDOW,
      );

      return {
        status: "ready" as const,
        context: {
          orgId: membership.orgId,
          orgName: membership.orgName,
          role: membership.role,
          tier,
          canReadOrgCalls: mentor,
        },
        surface,
        calls: mine.rows,
        orgCalls,
        trend,
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

type CoachRequest = {
  action: "coach";
  orgId: string;
  surface: LearningSurface;
  fieldLabel: string;
  unit: string;
  predicted: number;
  actual: number;
  closeness: string;
  deterministic: string;
  misconception: string | null;
  inputSummary: string;
};

function text(value: unknown, field: string, max: number, required = true): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw && required) throw new HttpError(400, `${field} is required`);
  return raw.slice(0, max);
}

function finite(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `${field} must be a number`);
  return parsed;
}

function parseCoachRequest(body: Record<string, unknown>): CoachRequest {
  return {
    action: "coach",
    orgId: text(body.orgId, "orgId", 64),
    surface: parseLearningSurface(body.surface),
    fieldLabel: text(body.fieldLabel, "fieldLabel", 80),
    unit: text(body.unit, "unit", 12, false),
    predicted: finite(body.predicted, "predicted"),
    actual: finite(body.actual, "actual"),
    closeness: text(body.closeness, "closeness", 20),
    deterministic: text(body.deterministic, "deterministic", 600),
    misconception: text(body.misconception, "misconception", 400, false) || null,
    inputSummary: text(body.inputSummary, "inputSummary", 400, false),
  };
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(
    `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

/**
 * POST /api/learning/predictions
 *  - default: commit one call (or one honest skip) to the append-only ledger.
 *  - action "coach": optional metered coach paragraph on top of the deterministic
 *    explanation the client already rendered. Degrades to a "configure a model"
 *    state; the lesson never depends on it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(new HttpError(400, "Invalid request body"));

  if (body.action === "coach") {
    try {
      const session = await requireSession();
      const input = parseCoachRequest(body);
      const paragraph = await withRls({ userId: session.user.id, orgId: input.orgId }, async (client) => {
        await requireMembership(client, input.orgId, session.user.id);
        const promptCachingEnabled = await getOrgPromptCachingEnabled(client, input.orgId);
        const adapter = await resolveOrgChatAdapter(client, {
          orgId: input.orgId,
          userId: session.user.id,
          promptCachingEnabled,
          feature: LEARNING_COACH_FEATURE,
          bridgeTransport: createBridgeTransport(),
        });
        const message = buildCoachPrompt({
          surface: input.surface,
          fieldLabel: input.fieldLabel,
          unit: input.unit,
          predicted: input.predicted,
          actual: input.actual,
          closeness: input.closeness,
          deterministic: input.deterministic,
          misconception: input.misconception,
          inputSummary: input.inputSummary,
        });
        const reply = await meteredAI({
          client,
          orgId: input.orgId,
          userId: session.user.id,
          feature: LEARNING_COACH_FEATURE,
          requestId: randomUUID(),
          estimatedCostUsd: 0.004,
          estimatedPromptTokens: Math.ceil(message.length / 4),
          estimatedCompletionTokens: 120,
          provider: adapter.provider,
          model: adapter.model,
          metadata: {
            action: "learning_coach",
            surface: input.surface,
            field: input.fieldLabel,
            closeness: input.closeness,
            ledgerTag: `${LEARNING_COACH_FEATURE}:${input.surface}`,
          },
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
        return cleanCoachParagraph(reply);
      });
      return Response.json({ paragraph });
    } catch (error) {
      // The maths already answered the student. A missing key is a "configure X"
      // state on an optional extra, never a failed lesson.
      return failMeteredAi(error, "The AI coach is unavailable right now.");
    }
  }

  try {
    const session = await requireSession();
    const { orgId, record } = parseLearningPrediction(body);
    const saved = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMembership(client, orgId, session.user.id);
      const inserted = await client.query<{ id: string; createdAt: string }>(
        `INSERT INTO learning_predictions
           (org_id, user_id, surface, inputs, predicted, actual, closeness, skipped)
         VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
         RETURNING id, created_at AS "createdAt"`,
        [
          orgId,
          session.user.id,
          record.surface,
          JSON.stringify(record.inputs),
          JSON.stringify(record.predicted),
          JSON.stringify(record.actual),
          record.closeness,
          record.skipped,
        ],
      );
      const row = inserted.rows[0]!;

      const recent = await client.query<{ closeness: Closeness | null; skipped: boolean; createdAt: string }>(
        `SELECT closeness, skipped, created_at AS "createdAt"
           FROM learning_predictions
          WHERE org_id = $1::uuid AND user_id = $2::uuid AND surface = $3
          ORDER BY created_at DESC
          LIMIT $4`,
        [orgId, session.user.id, record.surface, TREND_WINDOW],
      );
      return {
        id: row.id,
        trend: summarizeAccuracyTrend(
          recent.rows.map<PastCall>((r) => ({
            closeness: r.closeness,
            skipped: r.skipped,
            createdAt: String(r.createdAt),
          })),
          TREND_WINDOW,
        ),
      };
    });
    return Response.json(saved);
  } catch (error) {
    return fail(error);
  }
}
