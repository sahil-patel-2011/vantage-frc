import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getDisplayPool } from "@vantage/db/display";
import { headers } from "next/headers";
import { DISPLAY_SNAPSHOT_SELECT } from "../../../../lib/display";
import { TV_LINK_DEAD, displayFeedError } from "../../../../lib/display/display-errors";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (token) {
      const result = await getDisplayPool().query<{ snapshot: unknown }>(
        "SELECT get_display_snapshot($1) AS snapshot",
        [token],
      );
      const snapshot = result.rows[0]?.snapshot;
      if (!snapshot) {
        return Response.json({ error: TV_LINK_DEAD, code: "tv_link_dead" }, { status: 401 });
      }
      return Response.json(snapshot);
    }

    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = url.searchParams.get("orgId");
    const boardId = url.searchParams.get("boardId");
    if (!session || !orgId || !boardId) {
      return Response.json(
        { error: "Authentication, orgId, and boardId are required" },
        { status: 401 },
      );
    }

    const snapshot = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = await client.query<{ snapshot: unknown }>(
        `${DISPLAY_SNAPSHOT_SELECT} WHERE b.id = $1 AND b.org_id = $2`,
        [boardId, orgId],
      );
      return result.rows[0]?.snapshot ?? null;
    });

    if (!snapshot) {
      return Response.json({ error: "Display board not found" }, { status: 404 });
    }
    return Response.json(snapshot);
  } catch (error) {
    return displayFeedError(error, "snapshot");
  }
}
