import { auth, isInviteTokenShape, JOIN_LINK_COOKIE, redeemTeamJoinLink } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies, headers } from "next/headers";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Sign in to join this team" }, { status: 401 });
  }

  let token = "";
  try {
    const body = (await request.json()) as { token?: string };
    token = String(body.token ?? "").trim();
  } catch {
    token = "";
  }
  if (!token) {
    const jar = await cookies();
    token = jar.get(JOIN_LINK_COOKIE)?.value?.trim() ?? "";
  }
  if (!isInviteTokenShape(token)) {
    return Response.json({ error: "That join link is not valid" }, { status: 400 });
  }

  try {
    const joined = await withRls({ userId: session.user.id }, (client) => redeemTeamJoinLink(client, token));
    return Response.json({ ok: true, ...joined });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not join that team" },
      { status: 400 },
    );
  }
}
