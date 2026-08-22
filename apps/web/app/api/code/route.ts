import { createHash, randomUUID } from "node:crypto";
import { auth } from "@vantage/core";
import {
  BUGBOT_ULTRA_PRICES_USD,
  buildDiffProposal,
  bugbotFixUserMessage,
  bugbotRecheckUserMessage,
  bugbotUltraChargeUsd,
  bugbotUserMessage,
  getOrgPromptCachingEnabled,
  groundBugbotFix,
  mergeBugbotReview,
  resolveOrgChatAdapter,
  reviewFrcCode,
  type BugbotFinding,
  type BugbotTier,
  type BugbotUltraPhase,
} from "@vantage/agent";
import { withRls } from "@vantage/db";
import { meteredAI } from "@vantage/billing";
import { headers } from "next/headers";
import {
  createGitHubHttp,
  fetchGitHubFileSnippet,
  fetchGitHubScanBundle,
  getGitHubAccessToken,
  loadEditorContextItems,
  loadGitHubConnection,
  requireOrgMember,
} from "../../../lib/github";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

const fail = (error: unknown) => failMeteredAi(error, "Code assistant request failed");

function asReviewId(value?: string): string | null {
  const raw = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

type HydratedSource = {
  path: string;
  content: string;
  provenance: Array<{ type: string; label: string }>;
  empty?: string;
  filesScanned: number;
  githubRepo: string | null;
  githubRef: string | null;
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
    scanRepo?: boolean;
  },
): Promise<HydratedSource> {
  let path = String(body.path ?? "Robot.java").slice(0, 260);
  let content = String(body.content ?? "");
  const provenance: Array<{ type: string; label: string }> = [];
  let filesScanned = content.trim() ? 1 : 0;
  let githubRepo: string | null = body.githubRepo?.trim() || null;
  let githubRef: string | null = body.githubRef?.trim() || null;

  const needsRemote =
    Boolean(body.orgId) &&
    (body.scanRepo || body.editorContextId || body.githubPath) &&
    (body.scanRepo || !content.trim());

  if (needsRemote && body.orgId) {
    const hydrated = await withRls({ userId: sessionUserId, orgId: body.orgId }, async (client) => {
      await requireOrgMember(client, body.orgId!, sessionUserId);
      if (body.editorContextId && !body.scanRepo) {
        const items = await loadEditorContextItems(client, body.orgId!, sessionUserId, body.editorContextId);
        const first = items[0];
        if (first) {
          const match = first.id.match(/^vscode:[^:]+:(.+)$/);
          return {
            path: match?.[1] ?? path,
            content: first.content,
            provenance: [{ type: "vscode_selection", label: first.label }],
            filesScanned: 1,
            githubRepo,
            githubRef,
          };
        }
      }
      const authToken = await getGitHubAccessToken(client, body.orgId!);
      if (!authToken) {
        return {
          path,
          content: "",
          provenance: [] as Array<{ type: string; label: string }>,
          empty: "GitHub is not connected for this workspace.",
          filesScanned: 0,
          githubRepo,
          githubRef,
        };
      }
      const fullName = body.githubRepo || authToken.connection.defaultRepoFullName;
      if (!fullName) {
        return {
          path,
          content: "",
          provenance: [],
          empty: "No GitHub repository selected. Pick a repo on Bugbot or set a default in Team admin.",
          filesScanned: 0,
          githubRepo,
          githubRef,
        };
      }
      const ref = body.githubRef || authToken.connection.defaultRepoDefaultBranch || "main";
      const http = createGitHubHttp(authToken.accessToken);
      if (body.scanRepo) {
        const bundle = await fetchGitHubScanBundle(http, fullName, ref);
        return {
          path: bundle.path,
          content: bundle.content,
          provenance: [{ type: "github_repo", label: `GitHub ${fullName}@${ref} (${bundle.filesScanned} files)` }],
          empty: bundle.emptyReason ?? undefined,
          filesScanned: bundle.filesScanned,
          githubRepo: fullName,
          githubRef: ref,
        };
      }
      if (body.githubPath) {
        const snippet = await fetchGitHubFileSnippet(http, fullName, body.githubPath, ref);
        return {
          path: snippet.path,
          content: snippet.content,
          provenance: [{ type: "github_file", label: `GitHub ${fullName}:${snippet.path}` }],
          filesScanned: 1,
          githubRepo: fullName,
          githubRef: ref,
        };
      }
      return { path, content: "", provenance: [], filesScanned: 0, githubRepo: fullName, githubRef: ref };
    });
    path = hydrated.path.slice(0, 260);
    content = hydrated.content;
    provenance.push(...hydrated.provenance);
    filesScanned = hydrated.filesScanned;
    githubRepo = hydrated.githubRepo;
    githubRef = hydrated.githubRef;
    if (!content.trim()) {
      throw new Error(
        ("empty" in hydrated && hydrated.empty) ||
          "No editor/GitHub content available — paste code, pick a file, or connect GitHub.",
      );
    }
  }

  if (!content.trim()) throw new Error("content is required");
  if (content.length > 200_000) throw new Error("content exceeds the 200KB analysis limit");
  return {
    path,
    content,
    provenance,
    filesScanned: filesScanned || 1,
    githubRepo,
    githubRef,
  };
}

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
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
        tier: string;
        phase: string;
        githubRepo: string | null;
        chargeUsd: string;
        filesScanned: number;
      }>(
        `SELECT id, path, risk_level AS "riskLevel", local_risk_count AS "localRiskCount",
                model_finding_count AS "modelFindingCount", dropped_ungrounded AS "droppedUngrounded",
                provider, model, created_at AS "createdAt",
                tier, phase, github_repo AS "githubRepo", charge_usd::text AS "chargeUsd",
                files_scanned AS "filesScanned"
         FROM code_bugbot_reviews
         WHERE org_id=$1
         ORDER BY created_at DESC
         LIMIT 12`,
        [orgId],
      );
      const connection = await loadGitHubConnection(client, orgId);
      return {
        reviews: result.rows,
        ultra: BUGBOT_ULTRA_PRICES_USD,
        github: connection
          ? {
              connected: true,
              login: connection.githubLogin,
              defaultRepoFullName: connection.defaultRepoFullName,
              defaultRepoDefaultBranch: connection.defaultRepoDefaultBranch,
            }
          : { connected: false, login: null, defaultRepoFullName: null, defaultRepoDefaultBranch: null },
      };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

type BugbotBody = {
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
  scanRepo?: boolean;
  mode?: BugbotTier;
  phase?: BugbotUltraPhase;
  parentReviewId?: string;
  findings?: BugbotFinding[];
};

/**
 * Deterministic FRC code review, proposal-only diffs, and metered AI Bugbot.
 * Subscription uses org BYOK / coding credits. Ultra is a hosted flat SKU.
 * Bugbot never deploys. Model findings are dropped unless evidence is in the source.
 */
export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as BugbotBody;
    const hydrated = await hydrateSource(session.user.id, body);
    const { path, content, provenance, filesScanned, githubRepo, githubRef } = hydrated;

    if (body.action === "bugbot") {
      if (!body.orgId) throw new Error("orgId is required");
      const orgId = body.orgId;
      const mode: BugbotTier = body.mode === "ultra" ? "ultra" : "subscription";
      const phase: BugbotUltraPhase =
        body.phase === "fix" || body.phase === "recheck" ? body.phase : "scan";
      const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgMember(client, orgId, session.user.id);
        const local = reviewFrcCode({ path, content });
        const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
        const adapter = await resolveOrgChatAdapter(client, {
          orgId,
          promptCachingEnabled,
          feature: mode === "ultra" ? "bugbot_ultra" : "coding",
          preferPlatform: mode === "ultra",
        });
        const requestId = randomUUID();
        const chargeUsd = mode === "ultra" ? bugbotUltraChargeUsd(phase) : 0;
        const estimatedCostUsd =
          mode === "ultra" ? chargeUsd : phase === "fix" ? 0.04 : 0.02;
        const message =
          phase === "fix"
            ? bugbotFixUserMessage({
                path,
                content,
                findings: (body.findings ?? []).length
                  ? body.findings!
                  : local.risks.map((risk) => ({
                      severity: risk.severity,
                      finding: risk.message,
                      evidence: risk.evidence,
                    })),
              })
            : phase === "recheck"
              ? bugbotRecheckUserMessage({ path, content, localRisks: local.risks })
              : bugbotUserMessage({ path, content, localRisks: local.risks });
        const text = await meteredAI({
          client,
          orgId,
          userId: session.user.id,
          feature: mode === "ultra" ? "bugbot_ultra" : "coding",
          requestId,
          estimatedCostUsd,
          estimatedPromptTokens: Math.ceil(message.length / 4),
          estimatedCompletionTokens: phase === "fix" ? 1200 : 800,
          provider: adapter.provider,
          model: adapter.model,
          keySource: mode === "ultra" ? "platform" : undefined,
          metadata: {
            action: "bugbot",
            mode,
            phase,
            path,
            githubRepo,
            ledgerTag:
              mode === "ultra"
                ? `bugbot_ultra:${phase}:${orgId.slice(0, 8)}`
                : `coding:bugbot:${orgId.slice(0, 8)}`,
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
              costUsd: mode === "ultra" ? chargeUsd : result.costUsd,
              model: adapter.model,
              provider: adapter.provider,
              cacheReadInputTokens: result.cacheReadInputTokens,
              cacheWriteInputTokens: result.cacheWriteInputTokens,
              uncachedInputTokens: result.uncachedInputTokens,
            };
          },
        });
        const review = mergeBugbotReview({ path, content, modelText: text });
        const fix =
          phase === "fix" ? groundBugbotFix({ path, content, modelText: text }) : { unifiedDiff: null, dropped: false };
        const digest = createHash("sha256").update(content).digest("hex");
        const saved = await client.query<{ id: string }>(
          `INSERT INTO code_bugbot_reviews
            (org_id, created_by, path, content_sha256, provider, model, risk_level, findings,
             local_risk_count, model_finding_count, dropped_ungrounded,
             tier, phase, github_repo, github_ref, parent_id, proposed_diff, charge_usd, files_scanned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16::uuid,$17,$18,$19)
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
            mode,
            phase,
            githubRepo,
            githubRef,
            asReviewId(body.parentReviewId),
            fix.unifiedDiff,
            chargeUsd,
            filesScanned,
          ],
        );
        return {
          review,
          reviewId: saved.rows[0]?.id ?? null,
          provider: adapter.provider,
          model: adapter.model,
          provenance,
          mode,
          phase,
          chargeUsd,
          filesScanned,
          githubRepo,
          githubRef,
          proposedDiff: fix.unifiedDiff,
          fixDropped: phase === "fix" ? fix.dropped : false,
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
