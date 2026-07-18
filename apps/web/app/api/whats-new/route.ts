import { ackProductRelease, auth, listWhatsNewForUser } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  const releases = await withRls({ userId: session.user.id }, (client) =>
    listWhatsNewForUser(client, session.user.id),
  );
  return Response.json({ releases });
}

const ackSchema = z.object({
  releaseId: z.string().uuid(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = ackSchema.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "releaseId is required" }, { status: 400 });
  }

  await withRls({ userId: session.user.id }, (client) =>
    ackProductRelease(client, session.user.id, body.data.releaseId),
  );
  return Response.json({ status: "ok" });
}
