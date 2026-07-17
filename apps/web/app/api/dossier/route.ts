import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { computeTeamDossier } from "../../../lib/dossier/compute-dossier";
import type { DossierView } from "../../../lib/dossier/compute-dossier";

export type { DossierView };

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const teamParam = url.searchParams.get("team");
  const teamNumber = teamParam ? Number(teamParam) : null;
  if (teamParam && (!Number.isInteger(teamNumber) || (teamNumber as number) <= 0)) {
    return Response.json({ error: "team must be a positive integer" }, { status: 400 });
  }

  try {
    const view = await withRls({ userId: session.user.id }, async (client) =>
      computeTeamDossier(client, {
        userId: session.user.id,
        requestedOrg,
        teamNumber,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load dossier context. Select a workspace and confirm database access.",
        steps: [
          {
            id: "workspace",
            label: "Select workspace",
            detail: "Choose your team organization",
            href: "/workspace",
          },
          {
            id: "tba",
            label: "Sync TBA",
            detail: "Team identity from TBA cache",
            href: "/team/data",
          },
          {
            id: "statbotics",
            label: "Cache Statbotics EPA",
            detail: "Season EPA from Statbotics (public API)",
            href: "/team/data",
          },
        ],
        orgId: null,
        teamNumber: null,
        referenceAccess: {
          tbaConfigured: Boolean(process.env.TBA_AUTH_KEY?.trim()),
          platformEnvKey: Boolean(process.env.TBA_AUTH_KEY?.trim()),
          credentialAvailable: false,
          cacheHasSync: false,
          statbotics: { cacheHasMetrics: false, eventMetricRows: 0, yearMetricRows: 0 },
        },
      } satisfies DossierView,
      { status: 200 },
    );
  }
}
