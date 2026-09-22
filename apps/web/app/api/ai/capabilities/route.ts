import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { resolveAiCapabilities } from "../../../../lib/ai/capabilities";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * GET /api/ai/capabilities?orgId=
 *
 * Which AI agents this member can use on this team right now, and — for each one that cannot
 * run — one plain sentence saying why and where to fix it. Members only; computed on the
 * caller's RLS session from the same configuration the agents read (lib/ai/capabilities.ts).
 * Never returns key material: only whether a key or connection exists.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in to see AI status." }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
    return Response.json({ error: "orgId is required" }, { status: 400 });
  }
  try {
    const agents = await withRls({ userId: session.user.id, orgId }, (client) =>
      resolveAiCapabilities(client, { orgId, userId: session.user.id }),
    );
    return Response.json(
      { orgId, agents, checkedAt: new Date().toISOString() },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const message = publicErrorMessage(error, "Could not check AI status.");
    if (/access denied/i.test(message)) {
      return Response.json({ error: "You are not a member of this team." }, { status: 403 });
    }
    return Response.json(
      { error: "Could not check AI status right now.", status: "setup_required" },
      { status: 503 },
    );
  }
}
