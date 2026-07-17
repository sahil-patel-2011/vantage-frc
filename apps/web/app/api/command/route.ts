import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadEventDayCommand } from "../../../lib/command/load-command";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const snapshot = await withRls({ userId: session.user.id, orgId }, async (client) =>
      loadEventDayCommand(client, { orgId, userId: session.user.id }),
    );
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not load Event Day Command",
      },
      { status: 400 },
    );
  }
}
