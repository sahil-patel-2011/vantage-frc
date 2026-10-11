import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import {
  estimateAdapterCostUsd,
  getOrgPromptCachingEnabled,
  resolveOrgChatAdapterWithProvenance,
} from "@vantage/agent";
import { meteredAI } from "@vantage/billing";
import { createBridgeTransport } from "../ai-bridge/transport";
import { createGitHubHttp, fetchGitHubFileSnippet, fetchGitHubTree, resolveGitHubCommitSha } from "./api";
import { buildCodeMap, codeMapContext, codeMapFilesToRead, wantsRobotCode, type CodeMap, type RecentPrReview } from "./code-map";
import {
  parsePrReview,
  prReviewContextItems,
  prReviewMessage,
  selectReviewableFiles,
  type PrReviewFinding,
} from "./pr-review";
import { fetchPull, fetchPullFiles, type GitHubPullDetail } from "./pulls";
import { getGitHubAccessToken, markGitHubCredentialRejected } from "./tokens";
import { isGitHubCredentialRejected } from "./api";

/**
 * Running a pull request review against the database. Three short transactions, so a failed
 * AI call still leaves a visible "failed" row instead of rolling the whole thing back:
 *
 *   1. claimPrReview   — read the PR from GitHub, insert or reclaim the (repo, PR, commit) row
 *   2. runClaimedReview — the metered AI call (feature 'coding', the team's own key), then
 *                         store the grounded findings
 *   3. failPrReview     — when 2 throws, record the reason
 *
 * Every step runs inside withRls as a real member of the team.
 */

export type PrReviewRow = {
  id: string;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  title: string;
  authorLogin: string | null;
  htmlUrl: string | null;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  trigger: "manual" | "webhook";
  summary: string | null;
  risk: "low" | "medium" | "high" | null;
  findings: PrReviewFinding[];
  filesChanged: number;
  filesReviewed: number;
  additions: number;
  deletions: number;
  error: string | null;
  reviewedAt: string | null;
  updatedAt: string;
};

export const PR_REVIEW_COLUMNS = `id, repo_full_name AS "repoFullName", pr_number AS "prNumber", head_sha AS "headSha",
  title, author_login AS "authorLogin", html_url AS "htmlUrl", status, trigger, summary, risk, findings,
  files_changed AS "filesChanged", files_reviewed AS "filesReviewed", additions, deletions, error,
  reviewed_at AS "reviewedAt", updated_at AS "updatedAt"`;

export class PrReviewSetupError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "PrReviewSetupError";
  }
}

async function connectedRepo(client: PoolClient, orgId: string) {
  const auth = await getGitHubAccessToken(client, orgId);
  if (!auth) throw new PrReviewSetupError("Connect GitHub first: Connectors, then GitHub.");
  const repo = auth.connection.defaultRepoFullName?.trim();
  if (!repo) throw new PrReviewSetupError("Pick the robot code repository in the GitHub connector first.");
  return { http: createGitHubHttp(auth.accessToken), repo, branch: auth.connection.defaultRepoDefaultBranch?.trim() || "main" };
}

export type ClaimedReview = {
  reviewId: string;
  repo: string;
  pull: GitHubPullDetail;
  /** Already reviewed at this commit (and not a forced re-run): nothing to do. */
  alreadyDone: boolean;
};

export async function claimPrReview(
  client: PoolClient,
  input: { orgId: string; userId: string; number: number; trigger: "manual" | "webhook"; force?: boolean },
): Promise<ClaimedReview> {
  const { http, repo } = await connectedRepo(client, input.orgId);
  let pull: GitHubPullDetail;
  try {
    pull = await fetchPull(http, repo, input.number);
  } catch (error) {
    if (isGitHubCredentialRejected(error)) await markGitHubCredentialRejected(client, input.orgId);
    throw error;
  }
  const existing = await client.query<{ id: string; status: string; updatedAt: Date }>(
    `SELECT id, status, updated_at AS "updatedAt" FROM github_pr_reviews
      WHERE org_id = $1::uuid AND repo_full_name = $2::text AND pr_number = $3::int AND head_sha = $4::text`,
    [input.orgId, repo, pull.number, pull.headSha],
  );
  const row = existing.rows[0];
  const runningFresh = row?.status === "running" && Date.now() - new Date(row.updatedAt).getTime() < 5 * 60_000;
  if (row && (runningFresh || (row.status === "done" && !input.force))) {
    return { reviewId: row.id, repo, pull, alreadyDone: true };
  }
  const upsert = await client.query<{ id: string }>(
    `INSERT INTO github_pr_reviews
       (org_id, repo_full_name, pr_number, head_sha, base_ref, title, author_login, html_url, status, trigger,
        files_changed, additions, deletions, requested_by)
     VALUES ($1::uuid, $2::text, $3::int, $4::text, $5::text, $6::text, $7::text, $8::text, 'running', $9::text,
             $10::int, $11::int, $12::int, $13::uuid)
     ON CONFLICT (org_id, repo_full_name, pr_number, head_sha) DO UPDATE
       SET status = 'running', trigger = EXCLUDED.trigger, title = EXCLUDED.title, error = NULL,
           files_changed = EXCLUDED.files_changed, additions = EXCLUDED.additions, deletions = EXCLUDED.deletions,
           requested_by = EXCLUDED.requested_by, updated_at = now()
     RETURNING id`,
    [
      input.orgId,
      repo,
      pull.number,
      pull.headSha,
      pull.baseRef,
      pull.title,
      pull.authorLogin,
      pull.htmlUrl,
      input.trigger,
      pull.changedFiles,
      pull.additions,
      pull.deletions,
      input.userId,
    ],
  );
  return { reviewId: upsert.rows[0]!.id, repo, pull, alreadyDone: false };
}

async function storedCodeMapText(client: PoolClient, orgId: string): Promise<string | null> {
  const loaded = await loadCodeMap(client, orgId);
  return loaded ? loaded.context : null;
}

export async function runClaimedReview(
  client: PoolClient,
  input: { orgId: string; userId: string; claim: ClaimedReview },
): Promise<PrReviewRow> {
  const { claim } = input;
  const { http } = await connectedRepo(client, input.orgId);
  const files = await fetchPullFiles(http, claim.repo, claim.pull.number);
  const { reviewed, skipped } = selectReviewableFiles(files);
  if (!reviewed.length) {
    const rows = await client.query<PrReviewRow>(
      `UPDATE github_pr_reviews
          SET status = 'skipped', summary = $2::text, files_reviewed = 0, findings = '[]'::jsonb,
              reviewed_at = now(), updated_at = now()
        WHERE id = $1::uuid AND org_id = $3::uuid
        RETURNING ${PR_REVIEW_COLUMNS}`,
      [claim.reviewId, `Nothing to review: ${skipped.length} file${skipped.length === 1 ? "" : "s"} changed, none of them code with a readable diff.`, input.orgId],
    );
    return rows.rows[0]!;
  }

  const message = prReviewMessage({
    repoFullName: claim.repo,
    pull: claim.pull,
    files: reviewed,
    skipped,
    codeMap: await storedCodeMapText(client, input.orgId),
  });
  const context = prReviewContextItems(reviewed);
  const promptCachingEnabled = await getOrgPromptCachingEnabled(client, input.orgId);
  const { adapter } = await resolveOrgChatAdapterWithProvenance(client, {
    orgId: input.orgId,
    userId: input.userId,
    promptCachingEnabled,
    feature: "coding",
    bridgeTransport: createBridgeTransport(),
  });
  const estimatedPromptTokens = Math.ceil((message.length + context.reduce((sum, item) => sum + item.content.length, 0)) / 4);
  const estimatedCompletionTokens = 1_200;
  const text = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "coding",
    requestId: `pr-review:${claim.reviewId}:${randomUUID()}`,
    estimatedCostUsd: estimateAdapterCostUsd(adapter, estimatedPromptTokens, estimatedCompletionTokens),
    estimatedPromptTokens,
    estimatedCompletionTokens,
    provider: adapter.provider,
    model: adapter.model,
    metadata: {
      action: "pr_review",
      repo: claim.repo,
      pullRequest: claim.pull.number,
      headSha: claim.pull.headSha,
      ledgerTag: `coding:pr_review:${input.orgId.slice(0, 8)}`,
    },
    invoke: async () => {
      const result = await adapter.complete({ message, context, promptCachingEnabled });
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
  const review = parsePrReview(text, reviewed);
  const note = review.droppedUngrounded
    ? ` ${review.droppedUngrounded} suggestion${review.droppedUngrounded === 1 ? " was" : "s were"} left out because ${review.droppedUngrounded === 1 ? "it" : "they"} did not quote the diff.`
    : "";
  const rows = await client.query<PrReviewRow>(
    `UPDATE github_pr_reviews
        SET status = 'done', summary = $2::text, risk = $3::text, findings = $4::jsonb, files_reviewed = $5::int,
            error = NULL, reviewed_at = now(), updated_at = now()
      WHERE id = $1::uuid AND org_id = $6::uuid
      RETURNING ${PR_REVIEW_COLUMNS}`,
    [claim.reviewId, `${review.summary}${note}`.slice(0, 900), review.risk, JSON.stringify(review.findings), reviewed.length, input.orgId],
  );
  return rows.rows[0]!;
}

export async function failPrReview(client: PoolClient, input: { orgId: string; reviewId: string; message: string }) {
  await client.query(
    `UPDATE github_pr_reviews SET status = 'failed', error = $2::text, updated_at = now()
      WHERE id = $1::uuid AND org_id = $3::uuid`,
    [input.reviewId, input.message.slice(0, 500), input.orgId],
  );
}

export async function loadReviewRow(client: PoolClient, orgId: string, reviewId: string): Promise<PrReviewRow | null> {
  const rows = await client.query<PrReviewRow>(
    `SELECT ${PR_REVIEW_COLUMNS} FROM github_pr_reviews WHERE id = $1::uuid AND org_id = $2::uuid`,
    [reviewId, orgId],
  );
  return rows.rows[0] ?? null;
}

export async function listRecentReviews(client: PoolClient, orgId: string, limit = 40): Promise<PrReviewRow[]> {
  const rows = await client.query<PrReviewRow>(
    `SELECT ${PR_REVIEW_COLUMNS} FROM github_pr_reviews WHERE org_id = $1::uuid ORDER BY updated_at DESC LIMIT $2::int`,
    [orgId, limit],
  );
  return rows.rows;
}

// ---------------------------------------------------------------- code map --

export type StoredCodeMap = {
  repoFullName: string;
  ref: string;
  headSha: string;
  generatedAt: string;
  map: CodeMap;
  context: string;
};

export async function loadCodeMap(client: PoolClient, orgId: string): Promise<StoredCodeMap | null> {
  const rows = await client.query<{ repoFullName: string; ref: string; headSha: string; generatedAt: Date; codeMap: CodeMap }>(
    `SELECT repo_full_name AS "repoFullName", ref, head_sha AS "headSha", generated_at AS "generatedAt", code_map AS "codeMap"
       FROM github_code_index WHERE org_id = $1::uuid`,
    [orgId],
  );
  const row = rows.rows[0];
  if (!row || row.codeMap?.version !== 1) return null;
  const reviews = await client.query<RecentPrReview>(
    `SELECT pr_number AS "number", title, risk, summary, jsonb_array_length(findings)::int AS "findingCount",
            reviewed_at::text AS "reviewedAt"
       FROM github_pr_reviews
      WHERE org_id = $1::uuid AND status = 'done'
      ORDER BY reviewed_at DESC NULLS LAST LIMIT 5`,
    [orgId],
  );
  const generatedAt = new Date(row.generatedAt).toISOString();
  return {
    repoFullName: row.repoFullName,
    ref: row.ref,
    headSha: row.headSha,
    generatedAt,
    map: row.codeMap,
    context: codeMapContext({
      repoFullName: row.repoFullName,
      ref: row.ref,
      headSha: row.headSha,
      generatedAt,
      map: row.codeMap,
      reviews: reviews.rows,
    }),
  };
}

/** Rebuild the map of the default branch: one tree read and at most six small files. No AI. */
export async function refreshCodeMap(client: PoolClient, input: { orgId: string; userId: string }): Promise<StoredCodeMap | null> {
  const { http, repo, branch } = await connectedRepo(client, input.orgId);
  let sha: string | null;
  let tree: Awaited<ReturnType<typeof fetchGitHubTree>>;
  try {
    sha = await resolveGitHubCommitSha(http, repo, branch);
    if (!sha) throw new PrReviewSetupError(`GitHub has no branch "${branch}" in ${repo}.`, 404);
    tree = await fetchGitHubTree(http, repo, sha, { recursive: true, maxEntries: 5_000 });
  } catch (error) {
    if (isGitHubCredentialRejected(error)) await markGitHubCredentialRejected(client, input.orgId);
    throw error;
  }
  const files: Record<string, string> = {};
  for (const path of codeMapFilesToRead(tree.entries)) {
    try {
      files[path] = (await fetchGitHubFileSnippet(http, repo, path, sha, 40_000)).content;
    } catch {
      // A file we cannot read only leaves its part of the map empty.
    }
  }
  const map = buildCodeMap({ entries: tree.entries, truncated: tree.truncated, files });
  await client.query(
    `INSERT INTO github_code_index (org_id, repo_full_name, ref, head_sha, code_map, generated_by, generated_at)
     VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::uuid, now())
     ON CONFLICT (org_id) DO UPDATE
       SET repo_full_name = EXCLUDED.repo_full_name, ref = EXCLUDED.ref, head_sha = EXCLUDED.head_sha,
           code_map = EXCLUDED.code_map, generated_by = EXCLUDED.generated_by, generated_at = now()`,
    [input.orgId, repo, branch, sha, JSON.stringify(map), input.userId],
  );
  return loadCodeMap(client, input.orgId);
}

// ------------------------------------------------------------ AI context --

/** The stored code map and recent reviews as one chat context item, or nothing. */
export async function robotCodeContextItems(client: PoolClient, orgId: string, message: string) {
  if (!wantsRobotCode(message)) return [];
  const stored = await loadCodeMap(client, orgId);
  if (!stored) return [];
  return [
    {
      type: "github_file" as const,
      classification: "github_file" as const,
      id: `robot-code-map:${stored.headSha}`,
      label: `Robot code map (${stored.repoFullName}@${stored.headSha.slice(0, 7)})`,
      sourceUrl: `https://github.com/${stored.repoFullName}/tree/${stored.headSha}`,
      content: stored.context,
      importance: 60,
    },
  ];
}
