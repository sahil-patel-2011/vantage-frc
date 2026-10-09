import { assertOrgAuthentication, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies, headers } from "next/headers";
import { loadDataSourceHealth } from "../../../../lib/reference-health";
import { loadPickDesk } from "../../../../lib/strategy/pick-desk";

function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return privateJson({ error: "Your session ended. Sign in again." }, 401);
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (orgId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId)) return privateJson({ error: "Choose a valid team." }, 400);
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const desk = await loadPickDesk(client, { userId: session.user.id, requestedOrg: orgId });
      if (orgId && !desk.orgId) return null;
      if (desk.orgId) {
        try {
          await assertOrgAuthentication(client, {
            userId: session.user.id, orgId: desk.orgId, sessionId: session.session.id,
            authMethod: String((session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown"),
            rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value,
          });
        } catch { throw Object.assign(new Error("Team authentication required"), { status: 403 }); }
      }
      const dataSourceHealth = await loadDataSourceHealth(client, desk.orgId);
      return { ...desk, dataSourceHealth };
    });
    if (!view) return privateJson({ error: "Team access changed. Choose a team you belong to." }, 403);
    return privateJson(view);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 403) return privateJson({ error: "Your team's authentication requirements changed. Sign in again." }, 403);
    return privateJson({ error: "Pick desk is temporarily unavailable. Your saved lists have not been changed." }, 503);
  }
}
