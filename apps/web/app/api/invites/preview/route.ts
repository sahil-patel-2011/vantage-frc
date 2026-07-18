import { auth, peekOrganizationInvite } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { inviteTermsRequired } from "../../../../lib/invite";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

const limiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, namespace: "invite-preview" });

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  if (!(await limiter.allow(`${session.user.id}:${anonymizeIp(clientIp(request))}`))) {
    return rateLimitedResponse("Too many invite lookups. Wait a few minutes and try again.");
  }

  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return Response.json({ error: "Invite token is invalid" }, { status: 400 });
  }

  try {
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
      return privateJson({ preview: null, termsRequired: result.termsRequired }, { status: 404 });
    }
    const sessionEmail = session.user.email?.trim().toLowerCase();
    // Exact-email gate: never return org identity to a mismatched session.
    if (sessionEmail && result.preview.email.trim().toLowerCase() !== sessionEmail) {
      return privateJson({ error: "This invite was sent to a different email address." }, { status: 403 });
    }
    return privateJson({
      preview: result.preview,
      termsRequired: result.termsRequired,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load invite preview" },
      { status: 400 },
    );
  }
}
