import { auth, peekOrganizationInvite } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
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
    const preview = await withRls({ userId: session.user.id }, (client) =>
      peekOrganizationInvite(client, token),
    );
    if (!preview) return privateJson({ preview: null }, { status: 404 });
    const sessionEmail = session.user.email?.trim().toLowerCase();
    if (sessionEmail && preview.email.trim().toLowerCase() !== sessionEmail) {
      return privateJson({ error: "This invite was sent to a different email address." }, { status: 403 });
    }
    return privateJson({ preview });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load invite preview" },
      { status: 400 },
    );
  }
}
