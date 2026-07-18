import { auth, peekOrganizationInvite } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) return Response.json({ error: "Invite token is required" }, { status: 400 });

  try {
    const preview = await withRls({ userId: session.user.id }, (client) =>
      peekOrganizationInvite(client, token),
    );
    if (!preview) return Response.json({ preview: null }, { status: 404 });
    const sessionEmail = session.user.email?.trim().toLowerCase();
    if (sessionEmail && preview.email.trim().toLowerCase() !== sessionEmail) {
      return Response.json({ error: "This invite was sent to a different email address." }, { status: 403 });
    }
    return Response.json({ preview });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load invite preview" },
      { status: 400 },
    );
  }
}
