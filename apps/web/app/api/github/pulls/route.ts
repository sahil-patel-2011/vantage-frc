import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  createGitHubHttp,
  decryptWebhookSecret,
  encryptWebhookSecret,
  getGitHubAccessToken,
  isGitHubCredentialRejected,
  markGitHubCredentialRejected,
} from "../../../../lib/github";
import { reviewIsStale } from "../../../../lib/github/pr-review";
import {
  claimPrReview,
  failPrReview,
  listRecentReviews,
  loadCodeMap,
  PrReviewSetupError,
  refreshCodeMap,
  runClaimedReview,
  type PrReviewRow,
} from "../../../../lib/github/pr-review-run";
import { createRepoWebhook, deleteRepoWebhook, GitHubWebhookPermissionError, listOpenPulls } from "../../../../lib/github/pulls";
import { newWebhookSecret, newWebhookToken } from "../../../../lib/github/webhook-signature";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";
import { publicErrorMessage } from "../../../../lib/security/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A review is one metered model call over at most 60K characters of diff.
export const maxDuration = 60;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Sign in to see pull requests.");
  return session;
}

function fail(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof PrReviewSetupError) return Response.json({ error: error.message, setup: true }, { status: error.status });
  if (isGitHubCredentialRejected(error)) {
    return Response.json({ error: publicErrorMessage(error, "GitHub refused the saved sign-in."), credentialRejected: true }, { status: 502 });
  }
  return failMeteredAi(error, "Pull request review failed");
}

async function memberRole(client: Parameters<Parameters<typeof withRls>[1]>[0], orgId: string, userId: string): Promise<string> {
  const row = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  const role = row.rows[0]?.role;
  if (!role) throw new HttpError(403, "You are not on this team.");
  return role;
}

function webhookUrl(request: Request, token: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  return `${base}/api/github/webhook/${token}`;
}

/** Open pull requests on the connected repo, each with its latest review, and the code map. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId")?.trim();
    if (!orgId) throw new HttpError(400, "orgId is required");
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = await memberRole(client, orgId, session.user.id);
      const settings = await client.query<{
        repo: string | null;
        branch: string | null;
        status: string;
        prReviewsEnabled: boolean;
        lastDelivery: Date | null;
        webhookId: string | null;
      }>(
        `SELECT default_repo_full_name AS repo, default_repo_default_branch AS branch, status,
                pr_reviews_enabled AS "prReviewsEnabled", webhook_last_delivery_at AS "lastDelivery",
                webhook_id::text AS "webhookId"
           FROM github_connections WHERE org_id = $1::uuid AND disabled_at IS NULL`,
        [orgId],
      );
      const connection = settings.rows[0];
      const canManage = role === "owner" || role === "admin";
      const canReview = canManage || role === "scout";
      if (!connection || connection.status === "disconnected") {
        return { status: "setup" as const, reason: "not_connected" as const, canManage };
      }
      if (!connection.repo) return { status: "setup" as const, reason: "no_repo" as const, canManage };

      const reviews = await listRecentReviews(client, orgId);
      let pulls: Array<{
        number: number;
        title: string;
        authorLogin: string | null;
        htmlUrl: string | null;
        headSha: string;
        draft: boolean;
        updatedAt: string | null;
        review: (PrReviewRow & { stale: boolean }) | null;
      }> = [];
      let githubError: string | null = null;
      const auth = await getGitHubAccessToken(client, orgId);
      if (auth) {
        try {
          const open = await listOpenPulls(createGitHubHttp(auth.accessToken), connection.repo, 20);
          pulls = open.map((pull) => {
            const forPull = reviews.filter((r) => r.repoFullName === connection.repo && r.prNumber === pull.number);
            const latest = forPull.find((r) => r.headSha === pull.headSha) ?? forPull[0] ?? null;
            return {
              number: pull.number,
              title: pull.title,
              authorLogin: pull.authorLogin,
              htmlUrl: pull.htmlUrl,
              headSha: pull.headSha,
              draft: pull.draft,
              updatedAt: pull.updatedAt,
              review: latest ? { ...latest, stale: reviewIsStale(latest.status, latest.updatedAt) } : null,
            };
          });
        } catch (error) {
          if (isGitHubCredentialRejected(error)) await markGitHubCredentialRejected(client, orgId);
          githubError = publicErrorMessage(error, "GitHub did not answer. The saved reviews are below.");
        }
      }
      const openNumbers = new Set(pulls.map((p) => p.number));
      const earlier = reviews
        .filter((r) => !openNumbers.has(r.prNumber) && r.status === "done")
        .slice(0, 10);
      const codeMap = await loadCodeMap(client, orgId);
      return {
        status: "ready" as const,
        repo: connection.repo,
        branch: connection.branch ?? "main",
        canManage,
        canReview,
        autoReviews: {
          enabled: connection.prReviewsEnabled,
          lastDeliveryAt: connection.lastDelivery ? new Date(connection.lastDelivery).toISOString() : null,
          webhookRegistered: Boolean(connection.webhookId),
        },
        pulls,
        earlier,
        githubError,
        codeMap: codeMap ? { repoFullName: codeMap.repoFullName, ref: codeMap.ref, headSha: codeMap.headSha, generatedAt: codeMap.generatedAt, map: codeMap.map } : null,
      };
    });
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

type Body = { orgId?: string; action?: string; number?: number; enabled?: boolean };

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json().catch(() => ({}))) as Body;
    const orgId = body.orgId?.trim();
    if (!orgId) throw new HttpError(400, "orgId is required");
    const userId = session.user.id;

    if (body.action === "review") {
      const number = Number(body.number);
      if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, "Pick a pull request to review.");
      const claim = await withRls({ userId, orgId }, async (client) => {
        const role = await memberRole(client, orgId, userId);
        if (role === "viewer") throw new HttpError(403, "View only members can read reviews but not start one.");
        return claimPrReview(client, { orgId, userId, number, trigger: "manual", force: true });
      });
      try {
        const review = await withRls({ userId, orgId }, (client) => runClaimedReview(client, { orgId, userId, claim }));
        return Response.json({ review });
      } catch (error) {
        await withRls({ userId, orgId }, (client) =>
          failPrReview(client, { orgId, reviewId: claim.reviewId, message: publicErrorMessage(error, "The review did not finish.") }),
        ).catch(() => undefined);
        throw error;
      }
    }

    if (body.action === "refresh-map") {
      const codeMap = await withRls({ userId, orgId }, async (client) => {
        const role = await memberRole(client, orgId, userId);
        if (role === "viewer") throw new HttpError(403, "View only members can read the code map but not refresh it.");
        return refreshCodeMap(client, { orgId, userId });
      });
      return Response.json({ codeMap });
    }

    if (body.action === "auto-reviews") {
      const enable = body.enabled === true;
      const result = await withRls({ userId, orgId }, async (client) => {
        const role = await memberRole(client, orgId, userId);
        if (role !== "owner" && role !== "admin") throw new HttpError(403, "Only an owner or admin can turn automatic reviews on or off.");
        const auth = await getGitHubAccessToken(client, orgId);
        if (!auth) throw new PrReviewSetupError("Connect GitHub first: Connectors, then GitHub.");
        const repo = auth.connection.defaultRepoFullName?.trim();
        if (!repo) throw new PrReviewSetupError("Pick the robot code repository in the GitHub connector first.");
        const http = createGitHubHttp(auth.accessToken);
        const current = await client.query<{ webhookId: string | null; token: string | null; secret: string | null }>(
          `SELECT webhook_id::text AS "webhookId", webhook_token AS token, webhook_secret_encrypted AS secret
             FROM github_connections WHERE org_id = $1::uuid`,
          [orgId],
        );
        const existing = current.rows[0];
        if (!enable) {
          if (existing?.webhookId) await deleteRepoWebhook(http, repo, Number(existing.webhookId)).catch(() => undefined);
          await client.query(
            `UPDATE github_connections
                SET pr_reviews_enabled = false, webhook_id = NULL, webhook_token = NULL, webhook_secret_encrypted = NULL,
                    updated_at = now()
              WHERE org_id = $1::uuid`,
            [orgId],
          );
          return { enabled: false as const };
        }
        // A fresh token and secret each time reviews are turned on; an old hook is replaced.
        if (existing?.webhookId) await deleteRepoWebhook(http, repo, Number(existing.webhookId)).catch(() => undefined);
        const token = newWebhookToken();
        const secret = newWebhookSecret();
        const url = webhookUrl(request, token);
        let webhookId: number | null = null;
        let manual: { url: string; secret: string; events: string[] } | null = null;
        try {
          webhookId = (await createRepoWebhook(http, repo, { url, secret })).id;
        } catch (error) {
          if (!(error instanceof GitHubWebhookPermissionError)) throw error;
          // The saved token can read but not add webhooks: show the address and secret once
          // so an admin of the repo can paste them into GitHub. Only this owner/admin sees it.
          manual = { url, secret, events: ["pull_request", "push"] };
        }
        await client.query(
          `UPDATE github_connections
              SET pr_reviews_enabled = true, reviews_enabled_by = $2::uuid, webhook_token = $3::text,
                  webhook_secret_encrypted = $4::text, webhook_id = $5::bigint, updated_at = now()
            WHERE org_id = $1::uuid`,
          [orgId, userId, token, await encryptWebhookSecret(secret), webhookId],
        );
        // Prove the stored secret decrypts before telling anyone it is on.
        await decryptWebhookSecret(
          (await client.query<{ s: string }>(`SELECT webhook_secret_encrypted AS s FROM github_connections WHERE org_id = $1::uuid`, [orgId])).rows[0]!.s,
        );
        return { enabled: true as const, registered: webhookId !== null, manual };
      });
      // Map the code right away, so the first review already knows the repo.
      if (result.enabled) {
        await withRls({ userId, orgId }, (client) => refreshCodeMap(client, { orgId, userId })).catch(() => undefined);
      }
      return Response.json(result);
    }

    throw new HttpError(400, "Unknown action");
  } catch (error) {
    return fail(error);
  }
}
