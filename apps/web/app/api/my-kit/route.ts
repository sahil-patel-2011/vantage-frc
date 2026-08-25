import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadMyKit } from "../../../lib/my-kit/load-my-kit";

/** Session + per-user rows: never statically collected at build time. */
export const dynamic = "force-dynamic";

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

/** Read-only. My Kit composes other surfaces' data; it owns nothing, so there is no writer. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId") ?? undefined;

    const view = await withRls({ userId: session.user.id, orgId }, async (client) =>
      loadMyKit(client, { userId: session.user.id, orgId }),
    );

    return Response.json(view);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : "My Kit request failed" },
      { status },
    );
  }
}
