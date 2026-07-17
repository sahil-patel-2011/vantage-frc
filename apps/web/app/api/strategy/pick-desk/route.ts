import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadPickDesk } from "../../../../lib/strategy/pick-desk";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = new URL(request.url).searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, async (client) =>
      loadPickDesk(client, { userId: session.user.id, requestedOrg: orgId }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load pick desk. Confirm workspace and database access.",
        orgId: null,
        eventKey: null,
      },
      { status: 200 },
    );
  }
}
