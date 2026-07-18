import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadMyDay } from "../../../lib/load-my-day";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "My Day request failed" },
    { status },
  );
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id, orgId }, async (client) =>
      loadMyDay(client, { userId: session.user.id, orgId }),
    );

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
