import { getOrgPromptCachingEnabled, resolveOrgChatAdapterWithProvenance } from "@vantage/agent";
import { AgentRepository } from "@vantage/agent/repository";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import { headers } from "next/headers";
import {
  loadEditorContextItems,
  loadGitHubContextItems,
  type GitHubContextRequest,
} from "../../../lib/github";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}
const fail = (error: unknown) => failMeteredAi(error, "Agent request failed");

/**
 * Chat calls a real upstream model: give the function a 60s budget so the
 * adapter's own 50s timeout fires first and returns a classified error
 * instead of the platform killing the function mid-request.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId") ?? undefined;
    const threadId = url.searchParams.get("threadId");
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const repository = new AgentRepository(client);
      const promptCachingEnabled = orgId
          ? await getOrgPromptCachingEnabled(client, orgId)
          : true; // platform default since 0448 — personal chats cache too
      return {
        threads: await repository.listThreads(),
        memories: await repository.listUserMemories(session.user.id),
        memorySettings: await repository.getMemorySettings(session.user.id, orgId),
        messages: threadId ? await repository.getMessages(threadId) : [],
        promptCachingEnabled,
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
      action?: "thread" | "message";
      orgId?: string;
      threadId?: string;
      scope?: "private" | "team";
      title?: string;
      message?: string;
      selected?: { teamKey?: string; matchKey?: string };
      /** VS Code editor_context_submissions id from deep-link */
      editorContextId?: string;
      /** Optional GitHub file/tree request for this turn */
      githubContext?: GitHubContextRequest;
    };
    if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const orgId = body.orgId;
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const repository = new AgentRepository(client);
      const membership = await client.query("SELECT 1 FROM memberships WHERE org_id=$1", [body.orgId]);
      if (!membership.rowCount) throw new Error("Organization access denied");
      if (body.action === "thread") {
        if (!body.scope || !body.title) throw new Error("Thread scope and title are required");
        return { threadId: await repository.createThread(session.user.id, { orgId, scope: body.scope, title: body.title }) };
      }
      if (!body.threadId || !body.message?.trim() || !body.scope) throw new Error("Thread, scope, and message are required");
      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
      // Provenance rides along so the orchestrator can plan-gate hosted models through
      // routeModel (plan eligibility, PAYG-only, sponsored funding) and price the call.
      const { adapter, provenance } = await resolveOrgChatAdapterWithProvenance(client, {
        orgId,
        promptCachingEnabled,
        feature: "chat",
        // Prefer a paired subscription bridge (Claude Code / Codex on the
        // team's own machine) when one is online; falls through to keys.
        bridgeTransport: createBridgeTransport(),
      });

      const bridgeContext = [
        ...(body.editorContextId
          ? await loadEditorContextItems(client, orgId, session.user.id, body.editorContextId)
          : []),
        ...(body.githubContext
          ? await loadGitHubContextItems(client, orgId, body.githubContext)
          : []),
      ];

      return repository.sendMessage({
        userId: session.user.id,
        orgId: body.orgId!,
        threadId: body.threadId,
        message: body.message,
        scope: body.scope,
        adapter,
        requestId: crypto.randomUUID(),
        selected: body.selected,
        promptCachingEnabled,
        bridgeContext,
        modelSource: provenance.source,
      });
    });
    return Response.json(data, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
