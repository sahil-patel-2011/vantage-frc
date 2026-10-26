import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  claimDossierBuild,
  loadTeamDossier,
  resolveDossierOrg,
  type TeamDossierView,
} from "../../../../lib/team-dossier/store";
import { dispatchCron } from "../../../../lib/reference/dispatch-cron";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * The team dossier — what The Blue Alliance and Statbotics know about this
 * team, built once and refreshed weekly.
 *
 * GET returns it. POST {action:"build"} claims a build for an owner/admin and
 * asks the reference cron to run it. The page already shows status "running"
 * as "Gathering the public record" until that cron finishes. A claim row stops
 * two clicks building twice.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: unknown) {
  const message = publicErrorMessage(error, "Team dossier request failed");
  if (message === "forbidden") return Response.json({ error: "You are not a member of that team." }, { status: 403 });
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
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
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
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

    // The claim is the pending row the page already knows how to show. The
    // worker build runs on the cron route, which holds the admin role.
    const dispatched = await dispatchCron<{ status: "ready" | "failed" }>("/api/cron/reference-refresh", {
      kind: "team-dossier",
      orgId,
      teamNumber,
    });
    if (!dispatched.ok) {
      const view = await withRls({ userId, orgId }, (client) => loadTeamDossier(client, { orgId, userId }));
      return Response.json(view);
    }
    const view = await withRls({ userId, orgId }, (client) => loadTeamDossier(client, { orgId, userId }));
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
