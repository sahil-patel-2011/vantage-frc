import { acceptOrganizationInvite, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as { token?: string };
    if (!body.token) return Response.json({ error: "Invite token is required" }, { status: 400 });
    const orgId = await withRls({ userId: session.user.id }, (client) =>
      acceptOrganizationInvite(client, session.user.id, body.token!),
    );
    return Response.json({ orgId });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invite could not be accepted" },
      { status: 400 },
    );
  }
}
