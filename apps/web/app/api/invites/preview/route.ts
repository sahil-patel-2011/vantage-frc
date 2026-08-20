import { auth, isInviteTokenShape, peekOrganizationInvite } from "@vantage/core";
import { requestPool, withRls } from "@vantage/db";
import { headers } from "next/headers";
import { inviteTermsRequired } from "../../../../lib/invite";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

const limiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, namespace: "invite-preview" });

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

async function peekInvite(token: string) {
  const client = await requestPool.connect();
  try {
    return await peekOrganizationInvite(client, token);
  } finally {
    client.release();
  }
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const key = session
    ? `${session.user.id}:${anonymizeIp(clientIp(request))}`
    : `anon:${anonymizeIp(clientIp(request))}`;
  if (!(await limiter.allow(key))) {
    return rateLimitedResponse("Too many invite lookups. Wait a few minutes and try again.");
  }

  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!isInviteTokenShape(token)) {
    return Response.json({ error: "Invite token is invalid" }, { status: 400 });
  }

  try {
    if (!session) {
      const preview = await peekInvite(token);
      if (!preview) {
        return privateJson(
          { preview: null, signedIn: false, emailMismatch: false, termsRequired: true },
          { status: 404 },
        );
      }
      return privateJson({
        preview,
        signedIn: false,
        emailMismatch: false,
        termsRequired: true,
        sessionEmail: null,
      });
    }

    const result = await withRls({ userId: session.user.id }, async (client) => {
      const preview = await peekOrganizationInvite(client, token);
      const terms = await client.query<{ termsAcceptedAt: string | null }>(
        `SELECT terms_accepted_at::text AS "termsAcceptedAt"
         FROM profiles WHERE user_id = $1::uuid`,
        [session.user.id],
      );
      return {
        preview,
        termsRequired: inviteTermsRequired(terms.rows[0]?.termsAcceptedAt ?? null),
      };
    });
    if (!result.preview) {
      return privateJson(
        {
          preview: null,
          signedIn: true,
          emailMismatch: false,
          termsRequired: result.termsRequired,
          sessionEmail: session.user.email ?? null,
        },
        { status: 404 },
      );
    }
    const sessionEmail = session.user.email?.trim().toLowerCase() ?? "";
    const invitedEmail = result.preview.email.trim().toLowerCase();
    const emailMismatch = Boolean(sessionEmail && invitedEmail !== sessionEmail);
    return privateJson({
      preview: result.preview,
      signedIn: true,
      emailMismatch,
      termsRequired: result.termsRequired,
      sessionEmail: session.user.email ?? null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load invite preview" },
      { status: 400 },
    );
  }
}
