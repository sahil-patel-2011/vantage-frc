import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";
import { computeTeamDossier } from "../../../lib/dossier/compute-dossier";
import type { DossierView } from "../../../lib/dossier/compute-dossier";
import { dossierSetupSteps } from "../../../lib/dossier/dossier-related";
import { loadDataSourceHealth } from "../../../lib/reference-health";

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
    await hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg });
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const dossier = await computeTeamDossier(client, {
        userId: session.user.id,
        requestedOrg,
        teamNumber,
      });
      const dataSourceHealth = await loadDataSourceHealth(client, dossier.orgId);
      return { ...dossier, dataSourceHealth };
    });
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load dossier context. Choose your team and confirm database access.",
        steps: dossierSetupSteps(null),
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
