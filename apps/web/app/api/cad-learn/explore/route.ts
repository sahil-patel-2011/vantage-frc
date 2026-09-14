import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { acquireOnshape } from "../../../../lib/cad-learn/onshape-access";
import { parseOnshapeDocumentList } from "../../../../lib/cad-learn/explore-progress";
import { failResponse, HttpError, resolveMembership } from "../../../../lib/cad-learn/store";

/**
 * Documents on the caller's connected Onshape account.
 * Empty or disconnected is a clear setup state — never a fake progress %.
 */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const access = await acquireOnshape(client, membership.orgId, session.user.id);
      if (!access.ok) {
        return { status: "setup" as const, message: access.message };
      }
      const response = await access.http("/documents?filter=0&offset=0&limit=24");
      if (!response.ok) {
        return {
          status: "error" as const,
          message: "Onshape did not return your documents. Try again after you can open cad.onshape.com.",
        };
      }
      const body: unknown = await response.json().catch(() => null);
      return { status: "ready" as const, documents: parseOnshapeDocumentList(body) };
    });

    return Response.json(view);
  } catch (error) {
    return failResponse(error, "Could not load Explore Onshape");
  }
}
