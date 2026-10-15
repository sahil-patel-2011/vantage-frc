import { getOrgPromptCachingEnabled, isSkillToolOutput, resolveOrgChatAdapterWithProvenance, skillIdFromToolName, skillToolName } from "@vantage/agent";
import { AgentRepository } from "@vantage/agent/repository";
import { auth } from "@vantage/core";
import { withRls, withSavepoint } from "@vantage/db";
import { robotCodeContextItems } from "../../../lib/github/pr-review-run";
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import { headers } from "next/headers";
import {
  loadEditorContextItems,
  loadGitHubContextItems,
  type GitHubContextRequest,
} from "../../../lib/github";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import { probeChatAvailability } from "../../../lib/ai/capabilities";
import {
  ChatSendBlockedError,
  canConnectForTeam,
  chatConnectionForBlock,
  chatSendBlock,
  type ChatConnectionState,
} from "../../../lib/ai/chat-send-gate";
import { buildHistoryContext } from "../../../lib/chat/history-context";
import { aiSkillById, canSaveSkillDraft } from "../../../lib/ai-skills/catalog";
import type { SkillPageContext } from "../../../lib/ai-skills/executors";
import {
  availableSkillIds,
  buildSkillTools,
  loadSkillAccessFacts,
  meteredFeatureForSkill,
  routeSkillForTurn,
  runSkillPreview,
  sanitizeSkillPage,
  skillAvailabilityList,
  skillInstructions,
  skillPreviewOf,
  type RoutedSkill,
  type SkillAvailability,
} from "../../../lib/ai-skills/server";

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

/** The chip and starters: which skill a turn used, and how it was chosen. */
function skillSummary(routed: RoutedSkill | null, usedIds: string[]) {
  const skill = routed?.skill ?? aiSkillById(usedIds[0] ?? null);
  if (!skill) return null;
  return { id: skill.id, name: skill.name, group: skill.group, source: routed?.source ?? ("model" as const) };
}

/**
 * A turn refused for lack of a usable AI connection carries the composer's connection state, so
 * the notice and its next step stay on screen after "Not sent" instead of Send re-enabling.
 */
async function withConnectionState(
  response: Response,
  error: unknown,
  who: { userId: string; orgId: string; role: string | null },
): Promise<Response> {
  if (response.status !== 503) return response;
  const payload = (await response.clone().json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || payload.code !== "setup_required") return response;
  const message = typeof payload.message === "string" ? payload.message : null;
  let aiConnection: ChatConnectionState;
  if (error instanceof ChatSendBlockedError) {
    aiConnection = chatConnectionForBlock(error.block, who.role);
  } else {
    // Refused somewhere the gate didn't see: ask the check what to offer, but never say ready.
    const probed = who.userId && who.orgId
      ? await withRls({ userId: who.userId, orgId: who.orgId }, (client) =>
          probeChatAvailability(client, { orgId: who.orgId, userId: who.userId, role: who.role }),
        ).catch(() => null)
      : null;
    aiConnection = probed && !probed.configured
      ? probed
      : { configured: false, reason: "provider_unavailable", message, nextStep: canConnectForTeam(who.role) ? "settings" : "ask_owner" };
  }
  return Response.json({ ...payload, aiConnection }, { status: response.status });
}

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId") ?? undefined;
    const threadId = url.searchParams.get("threadId");
    // The AI-connection check walks the whole provider ladder (~30 queries). It has its own
    // request now, fetched beside this one, so the chat list and composer no longer wait for it.
    if (url.searchParams.get("part") === "connection") {
      const connection = await withRls({ userId: session.user.id, orgId }, async (client) => {
        const facts = orgId ? await loadSkillAccessFacts(client, orgId, session.user.id) : null;
        const model = orgId && facts?.role ? await withSavepoint(client, () => probeChatAvailability(client, { orgId, userId: session.user.id, role: facts.role }), null) : null;
        return model ?? (orgId ? { configured: false, reason: "check_unavailable", message: "Couldn't check your AI connection. Retry before sending; your question stays here.", nextStep: "retry" } : null);
      });
      return Response.json({ aiConnection: connection });
    }
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const repository = new AgentRepository(client);
      const promptCachingEnabled = orgId
          ? await getOrgPromptCachingEnabled(client, orgId)
          : true; // platform default since 0448 — personal chats cache too
      const facts = orgId ? await loadSkillAccessFacts(client, orgId, session.user.id) : null;
      return {
        threads: await repository.listThreads(),
        memories: await repository.listUserMemories(session.user.id),
        memorySettings: await repository.getMemorySettings(session.user.id, orgId),
        messages: threadId ? await repository.getMessages(threadId) : [],
        promptCachingEnabled,
        // Which Ask AI skills this member may use here, and in plain words why not.
        role: facts?.role ?? null,
        skills: facts ? skillAvailabilityList(facts) : [],
      };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  // Kept outside the transaction so a turn that fails because AI is off can still show what the
  // skill found in the team's records (read again in a fresh transaction below).
  let routed: RoutedSkill | null = null;
  let pinnedRefused: SkillAvailability | null = null;
  let page: SkillPageContext = {};
  let turnMessage = "";
  let userId = "";
  let orgIdForPreview = "";
  let role: string | null = null;
  try {
    const session = await current();
    userId = session.user.id;
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
      /** The skill the "Using …" chip is pinned to; null or "" lets the assistant choose. */
      skill?: string | null;
      /** The page Ask AI was opened from (path, a record it was about). */
      page?: unknown;
    };
    if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const orgId = body.orgId;
    orgIdForPreview = orgId;
    page = sanitizeSkillPage(body.page);
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const repository = new AgentRepository(client);
      const membership = await client.query("SELECT 1 FROM memberships WHERE org_id=$1", [body.orgId]);
      if (!membership.rowCount) throw new Error("Organization access denied");
      if (body.action === "thread") {
        if (!body.scope || !body.title) throw new Error("Thread scope and title are required");
        return { threadId: await repository.createThread(session.user.id, { orgId, scope: body.scope, title: body.title }) };
      }
      if (!body.threadId || !body.message?.trim() || !body.scope) throw new Error("Thread, scope, and message are required");
      const historyContext = buildHistoryContext({
        turns: await repository.getMessages(body.threadId),
        message: body.message,
      });
      turnMessage = historyContext.message;

      // One assistant, many skills: decide the skill before anything can fail, so the chip is
      // right even when the model can't run.
      const facts = await loadSkillAccessFacts(client, orgId, session.user.id);
      role = facts.role;
      const allowed = availableSkillIds(facts);
      ({ routed, pinnedRefused } = routeSkillForTurn({ pinned: body.skill, message: historyContext.message, allowed }));
      const turnSkill: RoutedSkill | null = routed;

      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
      const resolvedChat = await resolveOrgChatAdapterWithProvenance(client, {
        orgId,
        userId: session.user.id,
        promptCachingEnabled,
        feature: "chat",
        taskText: historyContext.message,
        // Prefer a paired subscription bridge (Claude Code / Codex on the
        // team's own machine) when one is online; falls through to keys.
        bridgeTransport: createBridgeTransport(),
      });
      // The same gate the connection check runs: refuse here, in the check's words, a model
      // billing would refuse after the turn was written (unknown → let meteredAI decide).
      const blocked = await withSavepoint(client, () => chatSendBlock(client, { orgId, source: resolvedChat.provenance.source }), null);
      if (blocked) throw new ChatSendBlockedError(blocked);
      const adapter = resolvedChat.adapter;

      const bridgeContext = [
        ...(body.editorContextId
          ? await loadEditorContextItems(client, orgId, session.user.id, body.editorContextId)
          : []),
        ...(body.githubContext
          ? await loadGitHubContextItems(client, orgId, body.githubContext)
          : []),
        // What the team's robot code looks like (code map + recent PR reviews), for questions
        // about the robot. Read from the stored map; no GitHub call on the chat path.
        ...(await withSavepoint(client, () => robotCodeContextItems(client, orgId, historyContext.message), [])),
      ];

      const sent = await repository.sendMessage({
        userId: session.user.id,
        orgId: body.orgId!,
        threadId: body.threadId,
        message: historyContext.message,
        scope: body.scope,
        adapter,
        requestId: crypto.randomUUID(),
        selected: body.selected ?? (page.teamKey || page.matchKey ? { teamKey: page.teamKey ?? undefined, matchKey: page.matchKey ?? undefined } : undefined),
        promptCachingEnabled,
        bridgeContext,
        conversationHistory: historyContext.history,
        extraTools: buildSkillTools({ allowed, request: historyContext.message, page }),
        forcedToolCalls: turnSkill
          ? [{ name: skillToolName(turnSkill.skill.id), input: { request: historyContext.message, about: page.about ?? null } }]
          : [],
        nativeCandidateToolNames: [...allowed].map(skillToolName),
        usageFeature: meteredFeatureForSkill(turnSkill?.skill ?? null, facts.policy),
        instructions: turnSkill ? skillInstructions(turnSkill.skill) : undefined,
      });
      const skillOutputs = sent.toolOutputs
        .map((tool) => tool.output)
        .filter(isSkillToolOutput)
        .map(skillPreviewOf);
      const usedIds = sent.toolOutputs.map((tool) => skillIdFromToolName(tool.name)).filter((id): id is string => Boolean(id));
      const skill = skillSummary(turnSkill, usedIds);
      return {
        ...sent,
        // Return the committed turn's exact messages; no second round trip to paint a reply.
        messages: await repository.getMessages(body.threadId),
        skill,
        skillNotice: pinnedRefused?.reason ?? null,
        skillOutputs,
        canSaveDraft: canSaveSkillDraft(aiSkillById(skill?.id ?? null), facts.role),
      };
    });
    return Response.json(data, { status: 201 });
  } catch (error) {
    const response = await withConnectionState(fail(error), error, { userId, orgId: orgIdForPreview, role: role as string | null });
    const turnSkill = routed as RoutedSkill | null;
    // AI is off, over its limit, or paused: still show what the skill found in the records.
    if (!turnSkill || !userId || !orgIdForPreview || ![402, 403, 429, 503].includes(response.status)) return response;
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || payload.reason === "view_only") return Response.json(payload ?? {}, { status: response.status });
    const preview = await withRls({ userId, orgId: orgIdForPreview }, (client) =>
      runSkillPreview({ client, orgId: orgIdForPreview, userId, skillId: turnSkill.skill.id, request: turnMessage, page }),
    ).catch(() => null);
    return Response.json(
      {
        ...payload,
        skill: { id: turnSkill.skill.id, name: turnSkill.skill.name, group: turnSkill.skill.group, source: turnSkill.source },
        skillNotice: (pinnedRefused as SkillAvailability | null)?.reason ?? null,
        skillPreview: preview,
        canSaveDraft: false,
        role,
      },
      { status: response.status },
    );
  }
}
