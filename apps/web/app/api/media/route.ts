import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeMediaView,
  currentSeasonYear,
  type MediaView,
} from "../../../lib/media/compute-media";

export type { MediaView };

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMediaView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Media workspace. Select a workspace and confirm database access.",
        steps: [
          {
            id: "workspace",
            label: "Select workspace",
            detail: "Choose your team organization",
            href: "/workspace",
          },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies MediaView,
      { status: 200 },
    );
  }
}
