import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { computeUnifiedSearch, type UnifiedSearchView } from "../../../lib/search/unified-search";

export type { UnifiedSearchView };

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeUnifiedSearch(client, { userId: session.user.id, requestedOrg, query }),
    );
    return Response.json(view);
  } catch {
    // Degrade to a clear setup state instead of a hard 500 when the DB is
    // unreachable (product routes are setup-required by design without one).
    return Response.json(
      {
        status: "setup_required",
        message: "Search is unavailable right now. Confirm database access and try again.",
        orgId: null,
        query: query ?? "",
      } satisfies UnifiedSearchView,
      { status: 200 },
    );
  }
}
