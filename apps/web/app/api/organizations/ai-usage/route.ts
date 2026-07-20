import {
  BYOK_RATES_DISCLAIMER,
  BYOK_RATES_SNAPSHOT_DATE,
  estimateByokCostUsd,
} from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function context(orgId: string | undefined) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !orgId) throw new Error("Authentication and organization are required");
  return { session, orgId };
}

const fail = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "BYOK usage request failed" },
    { status: 400 },
  );

/**
 * BYOK / local usage from ai_usage_events (key_source byo|local).
 * Cost estimates use public list rates — never invent DEMO rows.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId") ?? undefined;
    const windowDays = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 30) || 30));
    const { session } = await context(orgId);

    const payload = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, session.user.id],
      );
      if (!membership.rowCount) throw new Error("Organization access denied");

      const events = (
        await client.query<{
          id: string;
          createdAt: string;
          feature: string;
          provider: string;
          model: string;
          keySource: string;
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        }>(
          `SELECT id::text,
                  created_at::text AS "createdAt",
                  feature,
                  provider,
                  model,
                  key_source AS "keySource",
                  prompt_tokens AS "promptTokens",
                  completion_tokens AS "completionTokens",
                  total_tokens AS "totalTokens"
             FROM ai_usage_events
            WHERE org_id = $1::uuid
              AND key_source IN ('byo', 'local')
              AND created_at >= now() - ($2::int * interval '1 day')
            ORDER BY created_at DESC
            LIMIT 200`,
          [orgId, windowDays],
        )
      ).rows;

      const byModel = new Map<
        string,
        { provider: string; model: string; calls: number; promptTokens: number; completionTokens: number; estimatedUsd: number }
      >();
      let totalCalls = 0;
      let totalPrompt = 0;
      let totalCompletion = 0;
      let totalEstimated = 0;

      const enriched = events.map((row) => {
        const estimatedUsd = estimateByokCostUsd({
          provider: row.provider,
          model: row.model,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
        });
        totalCalls += 1;
        totalPrompt += row.promptTokens;
        totalCompletion += row.completionTokens;
        totalEstimated += estimatedUsd;
        const key = `${row.provider}::${row.model}`;
        const agg = byModel.get(key) ?? {
          provider: row.provider,
          model: row.model,
          calls: 0,
          promptTokens: 0,
          completionTokens: 0,
          estimatedUsd: 0,
        };
        agg.calls += 1;
        agg.promptTokens += row.promptTokens;
        agg.completionTokens += row.completionTokens;
        agg.estimatedUsd += estimatedUsd;
        byModel.set(key, agg);
        return { ...row, estimatedUsd };
      });

      return {
        windowDays,
        empty: events.length === 0,
        summary: {
          calls: totalCalls,
          promptTokens: totalPrompt,
          completionTokens: totalCompletion,
          totalTokens: totalPrompt + totalCompletion,
          estimatedUsd: totalEstimated,
        },
        byModel: [...byModel.values()].sort((a, b) => b.calls - a.calls),
        events: enriched.slice(0, 50),
        rates: {
          snapshotDate: BYOK_RATES_SNAPSHOT_DATE,
          disclaimer: BYOK_RATES_DISCLAIMER,
        },
      };
    });

    return Response.json(payload);
  } catch (error) {
    return fail(error);
  }
}
