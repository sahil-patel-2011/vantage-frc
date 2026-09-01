/**
 * POST /bugbot/pr — human-approved Bugbot write-PR.
 *
 * Loads the stored fix review (repo + sha + proposed_diff) and runs
 * `prepareBugbotWritePr` → `resolveBugbotTarget`. The editor textarea is never
 * a source. Metered AI is not invoked here.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  applyBugbotDiffToFiles,
  lastScanFromReview,
  prepareBugbotWritePr,
  submitApprovedBugbotPullRequest,
} from "../../../lib/bugbot";
import {
  createGitHubHttp,
  fetchGitHubFileSnippet,
  getGitHubAccessToken,
  requireOrgMember,
} from "../../../lib/github";

function asReviewId(value?: string): string | null {
  const raw = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json()) as {
    orgId?: string;
    reviewId?: string;
    humanApproved?: boolean;
  };
  const orgId = body.orgId?.trim();
  const reviewId = asReviewId(body.reviewId);
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (!reviewId) return Response.json({ error: "reviewId is required" }, { status: 400 });
  if (body.humanApproved !== true) {
    return Response.json({ error: "write-PR requires explicit human approval", requiresHumanApproval: true }, { status: 409 });
  }

  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      const review = await client.query<{
        githubRepo: string | null;
        githubRef: string | null;
        githubSha: string | null;
        proposedDiff: string | null;
        phase: string;
      }>(
        `SELECT github_repo AS "githubRepo", github_ref AS "githubRef", github_sha AS "githubSha",
                proposed_diff AS "proposedDiff", phase
           FROM code_bugbot_reviews
          WHERE id = $1::uuid AND org_id = $2::uuid`,
        [reviewId, orgId],
      );
      const row = review.rows[0];
      if (!row) throw new Error("Bugbot review not found");
      if (row.phase !== "fix" || !row.proposedDiff?.trim()) {
        throw new Error("write-PR needs a stored fix diff from that review");
      }

      const prepared = prepareBugbotWritePr({
        phase: "fix",
        lastScan: lastScanFromReview(row),
        humanApproved: true,
        unifiedDiff: row.proposedDiff,
      });

      const authToken = await getGitHubAccessToken(client, orgId);
      if (!authToken) throw new Error("GitHub is not connected for this workspace.");
      const http = createGitHubHttp(authToken.accessToken);
      const originals = await Promise.all(
        prepared.paths.map(async (path) => {
          const snippet = await fetchGitHubFileSnippet(http, prepared.repo, path, prepared.baseSha);
          return { path, content: snippet.content };
        }),
      );
      const files = applyBugbotDiffToFiles(originals, prepared.unifiedDiff);
      const opened = await submitApprovedBugbotPullRequest(http, prepared, files);
      return {
        ...opened,
        repo: prepared.repo,
        baseSha: prepared.baseSha,
        compareUrl: prepared.compareUrl,
        requiresHumanApproval: true,
        pushedToDefaultBranch: false,
      };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open the Bugbot pull request";
    return Response.json({ error: message }, { status: 400 });
  }
}
