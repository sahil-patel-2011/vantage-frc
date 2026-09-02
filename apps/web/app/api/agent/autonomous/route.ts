import {
  createVantageToolRegistry,
  getOrgPromptCachingEnabled,
  getAutonomousRunWithSteps,
  insertAutonomousRun,
  listAutonomousRuns,
  requestAutonomousRunCancel,
  resolveOrgChatAdapterWithProvenance,
  runAutonomousAgent,
} from "@vantage/agent";
import { createBridgeTransport } from "../../../../lib/ai-bridge/transport";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { after } from "next/server";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

const fail = (error: unknown) => failMeteredAi(error, "Autonomous agent request failed");

/**
 * POST creates the run row and answers {runId} at once; the ReAct loop then executes
 * after the response (next/server `after`), one committed transaction per step, so the
 * client polls GET ?runId= every couple of seconds and sees steps as they land. A bridged
 * step (a paired device with coverage 'everything') can hold a step open for the bridge
 * poll budget (BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS, 240s), so this function declares 300s to
 * keep headroom above it for the background work.
 *
 * 300s is only honored where the hosting plan's Node function cap reaches it. Below
 * that cap set VANTAGE_BRIDGE_MAX_WAIT_MS so the turn falls through to the team's own
 * keys instead of 504-ing — see docs/AI_BRIDGE.md "Function duration".
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const runId = url.searchParams.get("runId");
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query("SELECT 1 FROM memberships WHERE org_id=$1::uuid", [orgId]);
      if (!membership.rowCount) throw new Error("Organization access denied");
      if (runId) {
        const detail = await getAutonomousRunWithSteps(client, orgId, runId);
        return { run: detail?.run ?? null, steps: detail?.steps ?? [], setup_required: detail == null };
      }
      const runs = await listAutonomousRuns(client, orgId, 25);
      return {
        runs,
        empty: runs.length === 0,
        webSearchConfigured: Boolean(
          process.env.BRAVE_SEARCH_API_KEY?.trim() ||
            (process.env.RESEARCH_SEARCH_ENDPOINT?.trim() &&
              process.env.RESEARCH_SEARCH_API_KEY?.trim()),
        ),
        webBrowseEnabled: !["0", "false", "off", "no"].includes(
          (process.env.AGENT_WEB_BROWSE_ENABLED ?? "true").trim().toLowerCase(),
        ),
      };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as {
      action?: "run" | "cancel";
      orgId?: string;
      goal?: string;
      maxSteps?: number;
      runId?: string;
    };
    if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const orgId = body.orgId;
    const userId = session.user.id;

    if (body.action === "cancel") {
      const runId = String(body.runId ?? "").trim();
      if (!runId) return Response.json({ error: "runId is required" }, { status: 400 });
      const data = await withRls({ userId, orgId }, async (client) => {
        const membership = await client.query("SELECT 1 FROM memberships WHERE org_id=$1::uuid", [orgId]);
        if (!membership.rowCount) throw new Error("Organization access denied");
        const requested = await requestAutonomousRunCancel(client, { orgId, runId });
        const detail = await getAutonomousRunWithSteps(client, orgId, runId);
        return { runId, cancelRequested: requested, run: detail?.run ?? null, steps: detail?.steps ?? [] };
      });
      return Response.json(data);
    }

    const goal = String(body.goal ?? "").trim();
    if (!goal) return Response.json({ error: "goal is required" }, { status: 400 });
    const maxSteps = Math.min(Math.max(Number(body.maxSteps) || 8, 1), 20);
    const requestId = crypto.randomUUID();
    const bridgeTransport = createBridgeTransport();

    // Fail fast (503 setup_required) when no provider resolves, and persist the run row
    // before answering so the client can poll it immediately.
    const created = await withRls({ userId, orgId }, async (client) => {
      const membership = await client.query("SELECT 1 FROM memberships WHERE org_id=$1::uuid", [orgId]);
      if (!membership.rowCount) throw new Error("Organization access denied");
      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
      const { adapter, provenance } = await resolveOrgChatAdapterWithProvenance(client, {
        orgId,
        promptCachingEnabled,
        feature: "agent",
        bridgeTransport,
      });
      const runId = await insertAutonomousRun(client, {
        orgId,
        userId,
        goal,
        requestId,
        maxSteps,
        feature: "agent",
        provider: adapter.provider,
        model: adapter.model,
      });
      const detail = await getAutonomousRunWithSteps(client, orgId, runId);
      return { runId, run: detail?.run ?? null, promptCachingEnabled, modelSource: provenance.source };
    });

    // The loop runs after the response is sent. Each step commits on its own withRls
    // transaction; the adapter is resolved again on that connection because the request
    // client above is released once the POST returns.
    after(async () => {
      try {
        await withRls({ userId, orgId }, async (client) => {
          const { adapter, provenance } = await resolveOrgChatAdapterWithProvenance(client, {
            orgId,
            promptCachingEnabled: created.promptCachingEnabled,
            feature: "agent",
            bridgeTransport,
          });
          await runAutonomousAgent({
            client,
            orgId,
            userId,
            goal,
            adapter,
            requestId,
            maxSteps,
            runId: created.runId,
            registry: createVantageToolRegistry(),
            promptCachingEnabled: created.promptCachingEnabled,
            modelSource: provenance.source,
            transact: (work) => withRls({ userId, orgId }, work),
          });
        });
      } catch (error) {
        // runAutonomousAgent persists its own failure status; this only covers a resolver
        // failure between the POST and the first step.
        const message = error instanceof Error ? error.message : "Autonomous agent failed";
        await withRls({ userId, orgId }, async (client) => {
          await client.query(
            `UPDATE autonomous_agent_runs
                SET status = CASE WHEN status = 'running' THEN 'failed' ELSE status END,
                    error_class = COALESCE(error_class, 'error'),
                    error_message = COALESCE(error_message, $2),
                    finished_at = COALESCE(finished_at, now())
              WHERE id = $1::uuid`,
            [created.runId, message.slice(0, 2000)],
          );
        }).catch(() => undefined);
      }
    });

    return Response.json(
      { runId: created.runId, status: "running", run: created.run, persistedSteps: [] },
      { status: 202 },
    );
  } catch (error) {
    return fail(error);
  }
}
