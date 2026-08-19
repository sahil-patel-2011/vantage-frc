import { createHash, randomUUID } from "node:crypto";
import { auth } from "@vantage/core";
import {
  buildDiffProposal,
  bugbotUserMessage,
  getOrgPromptCachingEnabled,
  mergeBugbotReview,
  resolveOrgChatAdapter,
  reviewFrcCode,
} from "@vantage/agent";
import { withRls } from "@vantage/db";
import { meteredAI } from "@vantage/billing";
import { headers } from "next/headers";
import {
  createGitHubHttp,
  fetchGitHubFileSnippet,
  getGitHubAccessToken,
  loadEditorContextItems,
  requireOrgMember,
} from "../../../lib/github";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

const fail = (error: unknown) =>
  failMeteredAi(error, "Code assistant request failed");

type HydratedSource = {
  path: string;
  content: string;
  provenance: Array<{ type: string; label: string }>;
  empty?: string;
};

async function hydrateSource(
  sessionUserId: string,
  body: {
    orgId?: string;
    path?: string;
    content?: string;
    editorContextId?: string;
    githubPath?: string;
    githubRepo?: string;
    githubRef?: string;
  },
): Promise<HydratedSource> {
  let path = String(body.path ?? "Robot.java").slice(0, 260);
  let content = String(body.content ?? "");
  const provenance: Array<{ type: string; label: string }> = [];

  if (!content.trim() && body.orgId && (body.editorContextId || body.githubPath)) {
    const hydrated = await withRls({ userId: sessionUserId, orgId: body.orgId }, async (client) => {
      await requireOrgMember(client, body.orgId!, sessionUserId);
      if (body.editorContextId) {
        const items = await loadEditorContextItems(client, body.orgId!, sessionUserId, body.editorContextId);
        const first = items[0];
        if (first) {
          const match = first.id.match(/^vscode:[^:]+:(.+)$/);
          return {
            path: match?.[1] ?? path,
            content: first.content,
            provenance: [{ type: "vscode_selection", label: first.label }],
          };
        }
      }
      if (body.githubPath) {
        const authToken = await getGitHubAccessToken(client, body.orgId!);
        if (!authToken) {
          return {
            path,
            content: "",
            provenance: [] as Array<{ type: string; label: string }>,
            empty: "GitHub not connected",
          };
        }
        const fullName = body.githubRepo || authToken.connection.defaultRepoFullName;
        if (!fullName) {
          return { path, content: "", provenance: [], empty: "No default GitHub repo" };
        }
        const ref = body.githubRef || authToken.connection.defaultRepoDefaultBranch || "main";
        const snippet = await fetchGitHubFileSnippet(
          createGitHubHttp(authToken.accessToken),
          fullName,
          body.githubPath,
          ref,
        );
        return {
          path: snippet.path,
          content: snippet.content,
          provenance: [{ type: "github_file", label: `GitHub ${fullName}:${snippet.path}` }],
        };
      }
      return { path, content: "", provenance: [] as Array<{ type: string; label: string }> };
    });
    path = hydrated.path.slice(0, 260);
    content = hydrated.content;
    provenance.push(...hydrated.provenance);
    if (!content.trim()) {
      throw new Error(
        ("empty" in hydrated && hydrated.empty) ||
          "No editor/GitHub content available — paste code or connect GitHub / share from VS Code",
      );
    }
  }

  if (!content.trim()) throw new Error("content is required");
  if (content.length > 200_000) throw new Error("content exceeds the 200KB analysis limit");
  return { path, content, provenance };
}

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const reviews = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      const result = await client.query<{
        id: string;
        path: string;
        riskLevel: string;
        localRiskCount: number;
        modelFindingCount: number;
        droppedUngrounded: number;
        provider: string | null;
        model: string | null;
        createdAt: Date;
      }>(
        `SELECT id, path, risk_level AS "riskLevel", local_risk_count AS "localRiskCount",
                model_finding_count AS "modelFindingCount", dropped_ungrounded AS "droppedUngrounded",
                provider, model, created_at AS "createdAt"
         FROM code_bugbot_reviews
         WHERE org_id=$1
         ORDER BY created_at DESC
         LIMIT 12`,
        [orgId],
      );
      return result.rows;
    });
    return Response.json({ reviews });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Deterministic FRC code review, proposal-only diffs, and metered AI Bugbot.
 * Bugbot never deploys. Model findings are dropped unless evidence is in the source.
 */
export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as {
      action?: "review" | "propose" | "bugbot";
      orgId?: string;
      path?: string;
      content?: string;
      summary?: string;
      unifiedDiff?: string;
      editorContextId?: string;
      githubPath?: string;
      githubRepo?: string;
      githubRef?: string;
    };
    const hydrated = await hydrateSource(session.user.id, body);
    const { path, content, provenance } = hydrated;

    if (body.action === "bugbot") {
      if (!body.orgId) throw new Error("orgId is required");
      const orgId = body.orgId;
      const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgMember(client, orgId, session.user.id);
        const local = reviewFrcCode({ path, content });
        const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
        const adapter = await resolveOrgChatAdapter(client, {
          orgId,
          promptCachingEnabled,
          feature: "coding",
        });
        const requestId = randomUUID();
        const message = bugbotUserMessage({ path, content, localRisks: local.risks });
        const text = await meteredAI({
          client,
          orgId,
          userId: session.user.id,
          feature: "coding",
          requestId,
          estimatedCostUsd: 0.02,
          estimatedPromptTokens: Math.ceil(message.length / 4),
          estimatedCompletionTokens: 800,
          provider: adapter.provider,
          model: adapter.model,
          metadata: {
            action: "bugbot",
            path,
            ledgerTag: `coding:bugbot:${orgId.slice(0, 8)}`,
          },
          invoke: async () => {
            const result = await adapter.complete({
              message,
              context: [],
              promptCachingEnabled,
            });
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
        const review = mergeBugbotReview({ path, content, modelText: text });
        const digest = createHash("sha256").update(content).digest("hex");
        const saved = await client.query<{ id: string }>(
          `INSERT INTO code_bugbot_reviews
            (org_id, created_by, path, content_sha256, provider, model, risk_level, findings,
             local_risk_count, model_finding_count, dropped_ungrounded)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
           RETURNING id`,
          [
            orgId,
            session.user.id,
            path,
            digest,
            adapter.provider,
            adapter.model,
            review.riskLevel,
            JSON.stringify(review.findings),
            review.localRiskCount,
            review.modelFindingCount,
            review.droppedUngrounded,
          ],
        );
        return {
          review,
          reviewId: saved.rows[0]?.id ?? null,
          provider: adapter.provider,
          model: adapter.model,
          provenance,
        };
      });
      return Response.json(data, { status: 201 });
    }

    const review = reviewFrcCode({ path, content });
    if (body.action === "propose") {
      const proposal = buildDiffProposal({
        path,
        summary: String(body.summary ?? "Proposed safe change"),
        unifiedDiff: String(body.unifiedDiff ?? ""),
        review,
      });
      return Response.json({ review, proposal, provenance }, { status: 201 });
    }

    return Response.json({ review, provenance }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
