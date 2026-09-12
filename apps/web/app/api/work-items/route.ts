import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { computeWorkItemsView, type WorkItemsView } from "../../../lib/work-items/service";

export type { WorkItemsView };

/**
 * Read-only union of the three work trackers (todos, build tasks, season milestones) in one
 * canonical shape. `/api/todos`, `/api/tasks` and `/api/season-planning-workspace` keep their own
 * routes and payloads; this is the shared read for anything that needs all three to agree.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const parsedSeason = seasonParam ? Number(seasonParam) : NaN;
  const seasonYear =
    Number.isFinite(parsedSeason) && parsedSeason > 2000 && parsedSeason < 3000
      ? Math.round(parsedSeason)
      : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeWorkItemsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load work items. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies WorkItemsView,
      { status: 200 },
    );
  }
}
