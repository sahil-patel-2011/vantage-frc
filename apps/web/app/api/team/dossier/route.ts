import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  claimDossierBuild,
  failDossier,
  loadTeamDossier,
  resolveDossierOrg,
  saveDossier,
  type TeamDossierView,
} from "../../../../lib/team-dossier/store";

/**
 * The team dossier — what The Blue Alliance and Statbotics know about this
 * team, built once and refreshed weekly.
 *
 * GET returns it. POST {action:"build"} builds it now for an owner/admin. The
 * build itself is a bounded handful of calls through the platform's
 * coordinated TBA path (credential rotation, retry, the same client the season
 * sync uses) — it is not a poll and it is not a bare fetch. A claim row stops
 * two clicks building twice.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Team dossier request failed";
  if (message === "forbidden") return Response.json({ error: "You are not a member of that team." }, { status: 403 });
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const requested = new URL(request.url).searchParams.get("orgId");
  const userId = session.user.id;
  try {
    // No org in the URL is the common case from the Team hub; pick the
    // caller's own team the way the other team pages do.
    const orgId = await withRls({ userId }, (client) =>
      resolveDossierOrg(client, userId, requested && UUID.test(requested) ? requested : null),
    );
    if (!orgId) {
      return Response.json({ status: "none", teamNumber: null, canBuild: false, orgId: null } satisfies TeamDossierView & { orgId: null });
    }
    const view = await withRls({ userId, orgId }, (client) => loadTeamDossier(client, { orgId, userId }));
    return Response.json({ ...view, orgId } satisfies TeamDossierView & { orgId: string });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: { orgId?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  if (!UUID.test(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (body.action !== "build") return Response.json({ error: "Unknown action" }, { status: 400 });
  const userId = session.user.id;

  try {
    // Claim in its own transaction so a second click sees `running` at once.
    const teamNumber = await withRls({ userId, orgId }, (client) => claimDossierBuild(client, orgId));
    if (teamNumber === null) {
      const view = await withRls({ userId, orgId }, (client) => loadTeamDossier(client, { orgId, userId }));
      return Response.json(view);
    }

    const { createProductionReferenceJobs } = await import("@vantage/reference/production-worker");
    let payload;
    try {
      // preferOrgIds: this org's own TBA key (if it has one) is tried first,
      // the platform key otherwise — the coordinator decides.
      payload = await createProductionReferenceJobs({ preferOrgIds: [orgId] }).teamDossier.run(teamNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dossier build failed";
      await withRls({ userId, orgId }, (client) => failDossier(client, orgId, message));
      const view = await withRls({ userId, orgId }, (client) => loadTeamDossier(client, { orgId, userId }));
      return Response.json(view);
    }

    const view = await withRls({ userId, orgId }, async (client) => {
      await saveDossier(client, orgId, payload);
      return loadTeamDossier(client, { orgId, userId });
    });
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
