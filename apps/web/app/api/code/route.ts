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
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import {
  applyBugbotDismissals,
  BUGBOT_SCAN_CHUNK_FILES,
  BUGBOT_SCAN_MAX_CHUNKS,
  BUGBOT_SKIP_REASONS,
  bugbotScanCostUsd,
  bugbotScopeKey,
  type BugbotScanPlan,
  type BugbotSkipReason,
} from "@vantage/agent/bugbot";
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
  planGitHubBugbotScan,
  requireOrgMember,
  resolveGitHubCommitSha,
} from "../../../lib/github";
import { asCommitSha } from "../../../lib/bugbot/grounding";
import {
  dismissBugbotFinding,
  labelBugbotFindings,
  loadBugbotDismissals,
  loadOpenBugbotFindings,
  recordBugbotFindings,
  restoreBugbotFinding,
} from "../../../lib/code/bugbot-store";
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

/** What a pass covered — reported verbatim so partial coverage can never read as clean. */
type ScanCoverage = {
  reviewedFiles: string[];
  skipped: Array<{ path: string; reason: BugbotSkipReason }>;
  skipCounts: Array<{ reason: BugbotSkipReason; label: string; count: number }>;
  chunkIndex: number;
  chunkCount: number;
  candidateCount: number;
  deferredCount: number;
  treeTruncated: boolean;
  skippedListTruncated: boolean;
};

function bufferCoverage(path: string): ScanCoverage {
  return {
    reviewedFiles: [path],
    skipped: [],
    skipCounts: [],
    chunkIndex: 0,
    chunkCount: 1,
    candidateCount: 1,
    deferredCount: 0,
    treeTruncated: false,
    skippedListTruncated: false,
  };
}

function coverageFromPlan(
  plan: BugbotScanPlan,
  chunkIndex: number,
  reviewedFiles: string[],
  unreadable: Array<{ path: string; reason: BugbotSkipReason }>,
): ScanCoverage {
  const planned = plan.chunks[chunkIndex] ?? [];
  const missed = planned
    .filter((path) => !reviewedFiles.includes(path))
    .map((path) => ({
      path,
      reason: (unreadable.find((item) => item.path === path)?.reason ?? "not_robot_code") as BugbotSkipReason,
    }));
  // Chunk 0 carries the whole-repo skip list; later chunks only report their own misses.
  const skipped = chunkIndex === 0 ? [...plan.skipped.slice(0, 120), ...missed] : missed;
  return {
    reviewedFiles,
    skipped,
    skipCounts: plan.skipCounts,
    chunkIndex,
    chunkCount: plan.chunkCount,
    candidateCount: plan.candidateCount,
    deferredCount: plan.deferredCount,
    treeTruncated: plan.treeTruncated,
    skippedListTruncated: plan.skippedListTruncated,
  };
}

type HydratedSource = {
  path: string;
  content: string;
  provenance: Array<{ type: string; label: string }>;
  empty?: string;
  filesScanned: number;
  githubRepo: string | null;
  githubRef: string | null;
  /** Exact commit sha the remote content was fetched at (null for buffer/paste source). */
  githubSha: string | null;
  /** True when the request pinned a scanned sha and the branch head has moved past it. */
  branchMoved: boolean;
  coverage: ScanCoverage;
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
    githubSha?: string;
    scanRepo?: boolean;
    chunkIndex?: number;
  },
): Promise<HydratedSource> {
  let path = String(body.path ?? "Robot.java").slice(0, 260);
  let content = String(body.content ?? "");
  const provenance: Array<{ type: string; label: string }> = [];
  let filesScanned = content.trim() ? 1 : 0;
  let githubRepo: string | null = body.githubRepo?.trim() || null;
  let githubRef: string | null = body.githubRef?.trim() || null;
  let githubSha: string | null = null;
  let branchMoved = false;
  const chunkIndex = Math.min(
    BUGBOT_SCAN_MAX_CHUNKS - 1,
    Math.max(0, Math.floor(Number(body.chunkIndex ?? 0)) || 0),
  );
  // Assigned by both branches below (remote hydration reports its own coverage,
  // the buffer path reports the pasted file) — never left implicitly "full".
  let coverage: ScanCoverage;

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
          const editorPath = match?.[1] ?? path;
          return {
            path: editorPath,
            content: first.content,
            provenance: [{ type: "vscode_selection", label: first.label }],
            filesScanned: 1,
            githubRepo,
            githubRef,
            githubSha: null,
            branchMoved: false,
            coverage: bufferCoverage(editorPath),
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
          githubSha: null,
          branchMoved: false,
          coverage: bufferCoverage(path),
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
          githubSha: null,
          branchMoved: false,
          coverage: bufferCoverage(path),
        };
      }
      const ref = body.githubRef || authToken.connection.defaultRepoDefaultBranch || "main";
      const http = createGitHubHttp(authToken.accessToken);
      // Pin remote reads to an exact commit: a scan records the head sha it saw,
      // and a paid fix re-fetches THAT sha so the diff is grounded in the same
      // content that produced the findings — never the editor buffer.
      const pinnedSha = asCommitSha(body.githubSha);
      const headSha = await resolveGitHubCommitSha(http, fullName, ref);
      const fetchSha = pinnedSha ?? headSha;
      const moved = Boolean(pinnedSha && headSha && pinnedSha !== headSha);
      if (body.scanRepo) {
        // Plan first, on the server: the chunk's file list is derived from the tree
        // we just read, never from the client, and the skip list is reported back.
        const plan = await planGitHubBugbotScan(http, fullName, fetchSha ?? ref);
        const chunkFiles = plan.chunks[chunkIndex] ?? [];
        if (!chunkFiles.length) {
          return {
            path: `${fullName} scan`,
            content: "",
            provenance: [],
            empty: plan.candidateCount
              ? `Chunk ${chunkIndex + 1} is past the end of this scan (${plan.chunkCount} chunk${plan.chunkCount === 1 ? "" : "s"} planned).`
              : "No robot-code files (.java, .kt, .cpp, .py, …) in the connected repo tree after skipping vendordeps, build output, and generated sources.",
            filesScanned: 0,
            githubRepo: fullName,
            githubRef: ref,
            githubSha: fetchSha,
            branchMoved: moved,
            coverage: coverageFromPlan(plan, chunkIndex, [], []),
          };
        }
        const bundle = await fetchGitHubScanBundle(http, fullName, fetchSha ?? ref, { files: chunkFiles });
        return {
          path: bundle.path,
          content: bundle.content,
          provenance: [
            {
              type: "github_repo",
              label: `GitHub ${fullName}@${fetchSha ? fetchSha.slice(0, 7) : ref} · chunk ${chunkIndex + 1}/${plan.chunkCount} (${bundle.filesScanned} files)`,
            },
          ],
          empty: bundle.emptyReason ?? undefined,
          filesScanned: bundle.filesScanned,
          githubRepo: fullName,
          githubRef: ref,
          githubSha: fetchSha,
          branchMoved: moved,
          coverage: coverageFromPlan(plan, chunkIndex, bundle.files, bundle.unreadable),
        };
      }
      if (body.githubPath) {
        const snippet = await fetchGitHubFileSnippet(http, fullName, body.githubPath, fetchSha ?? ref);
        return {
          path: snippet.path,
          content: snippet.content,
          provenance: [{ type: "github_file", label: `GitHub ${fullName}:${snippet.path}` }],
          filesScanned: 1,
          githubRepo: fullName,
          githubRef: ref,
          githubSha: fetchSha,
          branchMoved: moved,
          coverage: bufferCoverage(snippet.path),
        };
      }
      return {
        path,
        content: "",
        provenance: [],
        filesScanned: 0,
        githubRepo: fullName,
        githubRef: ref,
        githubSha: null,
        branchMoved: false,
        coverage: bufferCoverage(path),
      };
    });
    path = hydrated.path.slice(0, 260);
    content = hydrated.content;
    provenance.push(...hydrated.provenance);
    filesScanned = hydrated.filesScanned;
    githubRepo = hydrated.githubRepo;
    githubRef = hydrated.githubRef;
    githubSha = hydrated.githubSha;
    branchMoved = hydrated.branchMoved;
    coverage = hydrated.coverage;
    if (!content.trim()) {
      throw new Error(
        ("empty" in hydrated && hydrated.empty) ||
          "No editor/GitHub content available — paste code, pick a file, or connect GitHub.",
      );
    }
  } else {
    coverage = bufferCoverage(path);
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
    githubSha,
    branchMoved,
    coverage,
  };
}

/**
 * Bugbot review/fix calls a real upstream model over repo snippets. A bridged turn (a paired device with
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

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");

    // Scan plan preview: free, no model call. Answers "what will this read, what
    // will it skip, and what does it cost" BEFORE the team presses the button.
    if (url.searchParams.get("plan") === "1") {
      const tier: BugbotTier = url.searchParams.get("tier") === "ultra" ? "ultra" : "subscription";
      const plan = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgMember(client, orgId, session.user.id);
        const authToken = await getGitHubAccessToken(client, orgId);
        if (!authToken) {
          return { empty: true as const, emptyReason: "GitHub is not connected for this workspace." };
        }
        const fullName = url.searchParams.get("repo")?.trim() || authToken.connection.defaultRepoFullName;
        if (!fullName) {
          return { empty: true as const, emptyReason: "No GitHub repository selected." };
        }
        const ref =
          url.searchParams.get("ref")?.trim() || authToken.connection.defaultRepoDefaultBranch || "main";
        const http = createGitHubHttp(authToken.accessToken);
        const sha = await resolveGitHubCommitSha(http, fullName, ref);
        const scanPlan = await planGitHubBugbotScan(http, fullName, sha ?? ref);
        return {
          empty: false as const,
          repo: fullName,
          ref,
          sha,
          chunkCount: scanPlan.chunkCount,
          chunkFiles: BUGBOT_SCAN_CHUNK_FILES,
          maxChunks: BUGBOT_SCAN_MAX_CHUNKS,
          reviewed: scanPlan.reviewed,
          skipped: scanPlan.skipped.slice(0, 120),
          skipCounts: scanPlan.skipCounts,
          skippedListTruncated: scanPlan.skippedListTruncated,
          candidateCount: scanPlan.candidateCount,
          deferredCount: scanPlan.deferredCount,
          treeTruncated: scanPlan.treeTruncated,
          skipReasons: BUGBOT_SKIP_REASONS,
          cost: bugbotScanCostUsd({ chunkCount: scanPlan.chunkCount, tier }),
          tier,
        };
      });
      return Response.json(plan);
    }

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
        githubSha: string | null;
        scopeKey: string | null;
        newFindingCount: number;
        knownFindingCount: number;
        fixedFindingCount: number;
        chunkIndex: number;
        chunkCount: number;
        partial: boolean;
        partialReason: string | null;
        scanFiles: string[];
      }>(
        `SELECT id, path, risk_level AS "riskLevel", local_risk_count AS "localRiskCount",
                model_finding_count AS "modelFindingCount", dropped_ungrounded AS "droppedUngrounded",
                provider, model, created_at AS "createdAt",
                tier, phase, github_repo AS "githubRepo", charge_usd::text AS "chargeUsd",
                files_scanned AS "filesScanned", github_sha AS "githubSha", scope_key AS "scopeKey",
                new_finding_count AS "newFindingCount", known_finding_count AS "knownFindingCount",
                fixed_finding_count AS "fixedFindingCount", chunk_index AS "chunkIndex",
                chunk_count AS "chunkCount", partial, partial_reason AS "partialReason",
                scan_files AS "scanFiles"
         FROM code_bugbot_reviews
         WHERE org_id=$1::uuid
         ORDER BY created_at DESC
         LIMIT 25`,
        [orgId],
      );
      const connection = await loadGitHubConnection(client, orgId);
      const scopeRepo = url.searchParams.get("repo")?.trim() || connection?.defaultRepoFullName || null;
      const scopeKey = bugbotScopeKey({ githubRepo: scopeRepo, path: url.searchParams.get("path") ?? "buffer" });
      const [openFindings, dismissals] = await Promise.all([
        loadOpenBugbotFindings(client, orgId, scopeKey),
        loadBugbotDismissals(client, orgId, scopeKey),
      ]);
      return {
        reviews: result.rows,
        ultra: BUGBOT_ULTRA_PRICES_USD,
        scan: { chunkFiles: BUGBOT_SCAN_CHUNK_FILES, maxChunks: BUGBOT_SCAN_MAX_CHUNKS },
        scopeKey,
        openFindings,
        dismissals,
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
  action?: "review" | "propose" | "bugbot" | "dismiss" | "restore";
  orgId?: string;
  path?: string;
  content?: string;
  summary?: string;
  unifiedDiff?: string;
  editorContextId?: string;
  githubPath?: string;
  githubRepo?: string;
  githubRef?: string;
  /** Commit sha a previous scan ran at — a fix phase re-fetches this exact content. */
  githubSha?: string;
  scanRepo?: boolean;
  mode?: BugbotTier;
  phase?: BugbotUltraPhase;
  parentReviewId?: string;
  findings?: BugbotFinding[];
  /** Which planned chunk of a repo scan this call covers (0-based). */
  chunkIndex?: number;
  /** Running spend the client has already been billed this scan, for honest reporting. */
  spentUsd?: number;
  /** dismiss / restore. */
  fingerprint?: string;
  reason?: string;
  filePath?: string;
  rule?: string;
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

    // Finding lifecycle: a dismissal is a judgement about a fingerprint, not a
    // review of source, so it never touches GitHub or a model.
    if (body.action === "dismiss" || body.action === "restore") {
      if (!body.orgId) throw new Error("orgId is required");
      const orgId = body.orgId;
      const scopeKey = bugbotScopeKey({
        githubRepo: body.githubRepo ?? null,
        path: String(body.path ?? "buffer"),
      });
      const fingerprint = String(body.fingerprint ?? "");
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgMember(client, orgId, session.user.id);
        if (body.action === "dismiss") {
          await dismissBugbotFinding(client, {
            orgId,
            userId: session.user.id,
            scopeKey,
            fingerprint,
            reason: String(body.reason ?? ""),
            filePath: body.filePath ?? null,
            rule: body.rule ?? null,
          });
        } else {
          await restoreBugbotFinding(client, { orgId, scopeKey, fingerprint });
        }
        return { dismissals: await loadBugbotDismissals(client, orgId, scopeKey) };
      });
      return Response.json({ ...result, scopeKey, fingerprint }, { status: 201 });
    }

    const hydrated = await hydrateSource(session.user.id, body);
    const { path, content, provenance, filesScanned, githubRepo, githubRef, githubSha, branchMoved, coverage } =
      hydrated;

    if (body.action === "bugbot") {
      if (!body.orgId) throw new Error("orgId is required");
      const orgId = body.orgId;
      const mode: BugbotTier = body.mode === "ultra" ? "ultra" : "subscription";
      const phase: BugbotUltraPhase =
        body.phase === "fix" || body.phase === "recheck" ? body.phase : "scan";
      const scopeKey = bugbotScopeKey({ githubRepo, path });
      const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgMember(client, orgId, session.user.id);
        const local = reviewFrcCode({ path, content });
        const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
        const adapter = await resolveOrgChatAdapter(client, {
          orgId,
          promptCachingEnabled,
          feature: mode === "ultra" ? "bugbot_ultra" : "coding",
          preferPlatform: mode === "ultra",
          bridgeTransport: createBridgeTransport(),
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
              : bugbotUserMessage({
                  path,
                  content,
                  localRisks: local.risks,
                  reviewedFiles: coverage.reviewedFiles,
                  chunkLabel:
                    coverage.chunkCount > 1
                      ? `${githubRepo ?? path} chunk ${coverage.chunkIndex + 1} of ${coverage.chunkCount}`
                      : null,
                });
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
            githubSha,
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
        const merged = mergeBugbotReview({ path, content, modelText: text });
        const fix =
          phase === "fix" ? groundBugbotFix({ path, content, modelText: text }) : { unifiedDiff: null, dropped: false };

        // Dismissals are per fingerprint and persist across commits: a team that
        // said "this one is deliberate" should not be told again every scan.
        const dismissals = await loadBugbotDismissals(client, orgId, scopeKey);
        const split = applyBugbotDismissals(
          merged.findings,
          dismissals.map((row) => row.fingerprint),
        );
        const review = {
          ...merged,
          findings: split.active,
          localRiskCount: split.active.filter((item) => item.source === "local_rule").length,
          modelFindingCount: split.active.filter((item) => item.source === "model").length,
        };

        const partial = coverage.chunkCount > 1 && coverage.chunkIndex + 1 < coverage.chunkCount;
        const partialReason = partial
          ? `chunk ${coverage.chunkIndex + 1} of ${coverage.chunkCount} — coverage is incomplete until every chunk runs`
          : coverage.deferredCount > 0
            ? `${coverage.deferredCount} robot-code file(s) are beyond this scan's chunk budget`
            : null;

        const digest = createHash("sha256").update(content).digest("hex");
        const saved = await client.query<{ id: string }>(
          `INSERT INTO code_bugbot_reviews
            (org_id, created_by, path, content_sha256, provider, model, risk_level, findings,
             local_risk_count, model_finding_count, dropped_ungrounded,
             tier, phase, github_repo, github_ref, parent_id, proposed_diff, charge_usd, files_scanned,
             github_sha, scope_key, scan_files, skipped_files, chunk_index, chunk_count,
             partial, partial_reason, dismissed_finding_count)
           VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16::uuid,$17,$18,$19,
                   $20,$21,$22::jsonb,$23::jsonb,$24,$25,$26,$27,$28)
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
            githubSha,
            scopeKey,
            JSON.stringify(coverage.reviewedFiles),
            JSON.stringify(coverage.skipped.slice(0, 120)),
            coverage.chunkIndex,
            Math.max(1, coverage.chunkCount),
            partial,
            partialReason,
            split.dismissed.length,
          ],
        );
        const reviewId = saved.rows[0]?.id ?? null;

        // Scan and recheck both re-read WHOLE files at the current head, so both
        // can resolve findings. A fix pass must never touch the history: it is
        // pinned to the previously scanned sha, and its model output is a diff —
        // `mergeBugbotReview` therefore sees zero model findings and would
        // "resolve" every model finding the scan had legitimately raised.
        const recordsLifecycle = phase !== "fix";
        const delta =
          recordsLifecycle
            ? await recordBugbotFindings(client, {
                orgId,
                scopeKey,
                reviewId,
                githubRepo,
                githubSha,
                reviewedFiles: coverage.reviewedFiles,
                findings: review.findings,
              })
            : { newCount: 0, knownCount: 0, fixedCount: 0, newFingerprints: [], fixedFingerprints: [], fixed: [] };

        if (recordsLifecycle && reviewId) {
          await client.query(
            `UPDATE code_bugbot_reviews
                SET new_finding_count = $2, known_finding_count = $3, fixed_finding_count = $4
              WHERE id = $1::uuid AND org_id = $5::uuid`,
            [reviewId, delta.newCount, delta.knownCount, delta.fixedCount, orgId],
          );
        }

        const labelled = recordsLifecycle
          ? labelBugbotFindings(review.findings, delta.newFingerprints)
          : review.findings;

        return {
          review: { ...review, findings: labelled },
          reviewId,
          provider: adapter.provider,
          model: adapter.model,
          provenance,
          mode,
          phase,
          chargeUsd,
          spentUsd: Number((Math.max(0, Number(body.spentUsd ?? 0)) + chargeUsd).toFixed(2)),
          filesScanned,
          githubRepo,
          githubRef,
          githubSha,
          branchMoved,
          scopeKey,
          coverage: { ...coverage, partial, partialReason },
          delta: {
            new: delta.newCount,
            known: delta.knownCount,
            fixed: delta.fixedCount,
            fixedFindings: delta.fixed.map((row) => ({
              fingerprint: row.fingerprint,
              filePath: row.filePath,
              rule: row.rule,
              finding: row.finding,
            })),
          },
          dismissedFindings: split.dismissed,
          dismissals,
          proposedDiff: fix.unifiedDiff,
          fixDropped: phase === "fix" ? fix.dropped : false,
          // The fix contract, restated on every response that carries a diff.
          executionState: "proposal_only" as const,
          requiresHumanApproval: true,
          pushedToGitHub: false,
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
