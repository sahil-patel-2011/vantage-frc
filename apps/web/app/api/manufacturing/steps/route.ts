// Shop steps (0737). GET: one part's steps (?partId=, the drawing QR page) or the
// shop queue (?kiosk=1, the shop kiosk). POST: one change, answered with the same view.
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { applyShopStepAction, computeShopStepsView } from "../../../../lib/manufacturing/steps";
import { parseShopStepAction, uuidOrNull } from "../../../../lib/manufacturing/steps-input";
import { publicErrorMessage } from "../../../../lib/security/public-error";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeShopStepsView(client, {
        userId: session.user.id,
        requestedOrg: uuidOrNull(params.get("orgId")),
        partId: uuidOrNull(params.get("partId")),
        kiosk: params.get("kiosk") === "1",
      }),
    );
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: publicErrorMessage(error, "Couldn't load the shop steps.") }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orgId = uuidOrNull(body?.orgId);
  if (!body || !orgId) return Response.json({ error: "Choose your team first." }, { status: 400 });
  const userId = session.user.id;
  try {
    const change = parseShopStepAction(body);
    const view = await withRls({ userId, orgId }, async (client) => {
      await applyShopStepAction(client, { orgId, userId, change });
      return computeShopStepsView(client, {
        userId,
        requestedOrg: orgId,
        partId: uuidOrNull(body.viewPartId),
        kiosk: body.view === "kiosk",
      });
    });
    return Response.json(view);
  } catch (error) {
    const message = publicErrorMessage(error, "That didn't save. Try again.");
    return Response.json({ error: message }, { status: /view only/i.test(message) ? 403 : 400 });
  }
}
