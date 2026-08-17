import { auth, claimFrcTeamWorkspace } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; slug?: string; teamNumber?: number };
  try {
    body = (await request.json()) as { name?: string; slug?: string; teamNumber?: number };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name || !body.slug || !body.teamNumber) {
    return Response.json({ error: "name, slug, and teamNumber are required" }, { status: 400 });
  }

  try {
    const id = await withRls({ userId: session.user.id }, (client) =>
      claimFrcTeamWorkspace(client, session.user.id, {
        name: body.name!,
        slug: body.slug!,
        teamNumber: Number(body.teamNumber),
      }),
    );
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not claim team";
    return Response.json({ error: message }, { status: 400 });
  }
}
