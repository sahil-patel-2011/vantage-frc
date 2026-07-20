import {
  createVantageToolRegistry,
  getOrgPromptCachingEnabled,
  getAutonomousRunWithSteps,
  listAutonomousRuns,
  resolveOrgChatAdapter,
  runAutonomousAgent,
} from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

const fail = (error: unknown) => failMeteredAi(error, "Autonomous agent request failed");

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
      orgId?: string;
      goal?: string;
      maxSteps?: number;
    };
    if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const goal = String(body.goal ?? "").trim();
    if (!goal) return Response.json({ error: "goal is required" }, { status: 400 });
    const orgId = body.orgId;
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query("SELECT 1 FROM memberships WHERE org_id=$1::uuid", [orgId]);
      if (!membership.rowCount) throw new Error("Organization access denied");

      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
      const adapter = await resolveOrgChatAdapter(client, {
        orgId,
        promptCachingEnabled,
        feature: "agent",
      });

      const result = await runAutonomousAgent({
        client,
        orgId,
        userId: session.user.id,
        goal,
        adapter,
        requestId: crypto.randomUUID(),
        maxSteps: body.maxSteps,
        registry: createVantageToolRegistry(),
        promptCachingEnabled,
      });

      const detail = await getAutonomousRunWithSteps(client, orgId, result.runId);
      return {
        ...result,
        run: detail?.run ?? null,
        persistedSteps: detail?.steps ?? [],
      };
    });
    return Response.json(data, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
