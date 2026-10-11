import { withRls } from "@vantage/db";
import { after } from "next/server";
import { decryptWebhookSecret } from "../../../../../lib/github";
import {
  claimPrReview,
  failPrReview,
  refreshCodeMap,
  runClaimedReview,
} from "../../../../../lib/github/pr-review-run";
import { isWebhookToken, verifyGitHubSignature } from "../../../../../lib/github/webhook-signature";
import { publicErrorMessage } from "../../../../../lib/security/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GitHub's pull request and push deliveries for one team's repo.
 *
 *   1. The URL token picks the team (github_pr_webhook_target, callable with no signed-in
 *      person; every table policy refuses that context, so nothing else is reachable).
 *   2. X-Hub-Signature-256 must verify against that team's own secret over the raw body.
 *   3. Only then: a pull request opened/updated → review it; a push to the default branch →
 *      remap the code. Both run after the response (GitHub waits 10 s) under RLS as the
 *      owner/admin who turned automatic reviews on, metered to the team like any review.
 *
 * Unknown token → 404, bad signature → 401, anything ignored → 202 with the reason.
 */

type Target = {
  orgId: string;
  actingUserId: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  secret: string | null;
  enabled: boolean;
};

const REVIEW_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

async function loadTarget(token: string): Promise<Target | null> {
  return withRls({ userId: "" }, async (client) => {
    const rows = await client.query<{
      orgId: string;
      actingUserId: string | null;
      repoFullName: string | null;
      defaultBranch: string | null;
      secret: string | null;
      enabled: boolean;
    }>(
      `SELECT org_id AS "orgId", acting_user_id AS "actingUserId", repo_full_name AS "repoFullName",
              default_branch AS "defaultBranch", webhook_secret_encrypted AS secret, pr_reviews_enabled AS enabled
         FROM github_pr_webhook_target($1::text)`,
      [token],
    );
    return rows.rows[0] ?? null;
  });
}

function ignored(reason: string) {
  return Response.json({ ok: true, ignored: reason }, { status: 202 });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isWebhookToken(token)) return Response.json({ error: "Not found" }, { status: 404 });
  const rawBody = await request.text();
  const target = await loadTarget(token).catch(() => null);
  if (!target?.secret) return Response.json({ error: "Not found" }, { status: 404 });
  const secret = await decryptWebhookSecret(target.secret).catch(() => null);
  if (!secret || !verifyGitHubSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    return Response.json({ error: "Signature did not verify" }, { status: 401 });
  }
  await withRls({ userId: "" }, (client) => client.query(`SELECT github_pr_webhook_touch($1::text)`, [token])).catch(() => undefined);

  const event = request.headers.get("x-github-event") ?? "";
  if (event === "ping") return Response.json({ ok: true, pong: true });
  if (!target.enabled) return ignored("automatic reviews are off");
  if (!target.actingUserId) return ignored("no one turned reviews on");

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body is not JSON" }, { status: 400 });
  }
  const repository = (payload.repository ?? {}) as { full_name?: unknown };
  if (typeof repository.full_name !== "string" || repository.full_name.toLowerCase() !== (target.repoFullName ?? "").toLowerCase()) {
    return ignored("not the team's connected repository");
  }
  const orgId = target.orgId;
  const userId = target.actingUserId;

  if (event === "pull_request") {
    const action = typeof payload.action === "string" ? payload.action : "";
    const pull = (payload.pull_request ?? {}) as { number?: unknown; draft?: unknown };
    const number = typeof pull.number === "number" ? pull.number : NaN;
    if (!REVIEW_ACTIONS.has(action)) return ignored(`pull_request ${action}`);
    if (pull.draft === true) return ignored("draft pull request");
    if (!Number.isInteger(number) || number <= 0) return Response.json({ error: "No pull request number" }, { status: 400 });
    after(async () => {
      let reviewId: string | null = null;
      try {
        const claim = await withRls({ userId, orgId }, (client) =>
          claimPrReview(client, { orgId, userId, number, trigger: "webhook" }),
        );
        if (claim.alreadyDone) return;
        reviewId = claim.reviewId;
        await withRls({ userId, orgId }, (client) => runClaimedReview(client, { orgId, userId, claim }));
      } catch (error) {
        const message = publicErrorMessage(error, "The automatic review did not finish.");
        console.warn(`[github-webhook] review of #${number} for ${orgId.slice(0, 8)} failed: ${message}`);
        if (reviewId) {
          const id = reviewId;
          await withRls({ userId, orgId }, (client) => failPrReview(client, { orgId, reviewId: id, message })).catch(() => undefined);
        }
      }
    });
    return Response.json({ ok: true, queued: "review", number }, { status: 202 });
  }

  if (event === "push") {
    const ref = typeof payload.ref === "string" ? payload.ref : "";
    if (ref !== `refs/heads/${target.defaultBranch ?? "main"}`) return ignored("push to another branch");
    after(async () => {
      await withRls({ userId, orgId }, (client) => refreshCodeMap(client, { orgId, userId })).catch((error) => {
        console.warn(`[github-webhook] code map for ${orgId.slice(0, 8)} failed: ${publicErrorMessage(error, "remap failed")}`);
      });
    });
    return Response.json({ ok: true, queued: "code-map" }, { status: 202 });
  }

  return ignored(`event ${event || "unknown"}`);
}
