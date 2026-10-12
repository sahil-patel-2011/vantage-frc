import {
  AIOrchestrator,
  getOrgPromptCachingEnabled,
  resolveOrgChatAdapterWithProvenance,
  type ChatAdapter,
  type ResolvedModelProvenance,
} from "@vantage/agent";
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { INSIGHT_CAPABILITY, parseInsightRequest, type BuiltInsight } from "../../../lib/ai-insights";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import { loadInsight } from "../../../lib/ai-insights-load";

/**
 * mode "ai" can reach a real upstream model. A bridged turn (a paired device with
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
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return failMeteredAi(error, "Insight request failed");
}

/**
 * Deterministic local provider (the default, zero-config path), mirroring
 * LocalSummaryProvider: the analysis text is derived entirely from org data by
 * the pure builders; the orchestrator still meters, records provenance, and
 * writes the ai_runs ledger. The UI labels this output "Computed from your
 * data" — the AI badge is reserved for mode "ai", which swaps in a real
 * resolved model adapter over the same grounded sources.
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

      // Default is the deterministic local analysis (labeled "Computed from
      // your data" in the panel). mode "ai" is the opt-in "Expand with AI"
      // path: the same grounded sources through a real resolved model. A
      // resolution failure surfaces as setup_required (503) — the panel keeps
      // the computed text on screen.
      let adapter: ChatAdapter;
      let provenance: ResolvedModelProvenance | null = null;
      if (parsed.mode === "ai") {
        ({ adapter, provenance } = await resolveOrgChatAdapterWithProvenance(client, {
          orgId: parsed.orgId,
          userId,
          promptCachingEnabled: await getOrgPromptCachingEnabled(client, parsed.orgId),
          feature: "ai_insights",
          bridgeTransport: createBridgeTransport(),
        }));
      } else {
        // Deterministic branch keeps no provenance — nothing external answered.
        adapter = localInsightAdapter(built);
      }

      const run = await new AIOrchestrator(client).run({
        orgId: parsed.orgId,
        userId,
        requestId: crypto.randomUUID(),
        capability: INSIGHT_CAPABILITY[parsed.kind],
        privacyScope: "team",
        message: built.message,
        adapter,
        contextSources: built.sources,
      });
      return {
        text: run.text,
        runId: run.runId,
        provider: run.provider,
        model: run.model,
        baseUrlOrigin: provenance?.baseUrlOrigin ?? null,
        // Which key paid for the model call — distinct from `source` below,
        // which says whether the text is computed or AI-expanded.
        keySource: provenance?.source ?? null,
        sourceCount: run.contextSources.length,
        source: parsed.mode === "ai" ? ("ai" as const) : ("computed" as const),
        generatedAt: new Date().toISOString(),
      };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
