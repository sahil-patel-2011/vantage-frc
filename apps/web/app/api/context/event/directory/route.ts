import { assertOrgAuthentication, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { canManageScouting } from "@vantage/scouting/permissions";
import { cookies, headers } from "next/headers";
import { parseEventYear } from "../../../../../lib/events/event-planning";
import { dispatchCron } from "../../../../../lib/reference/dispatch-cron";
import { publicErrorMessage } from "../../../../../lib/security/public-error";

/** Intentional bounded refresh. The worker runs on the reference cron, not in this request. */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Sign in to refresh published events." }, { status: 401 });
    const body = await request.json() as { orgId?: string; year?: number };
    if (!body.orgId) throw new Error("Choose your team first.");
    const orgId = body.orgId;
    const year = parseEventYear(String(body.year));
    await withRls({ userId: session.user.id, orgId }, async client => {
      if (!await canManageScouting(client, orgId)) throw new Error("Ask your scouting lead to refresh the event directory.");
      await assertOrgAuthentication(client, {
        userId: session.user.id, orgId, sessionId: session.session.id,
        authMethod: String((session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown"),
        rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value,
      });
    });
    const dispatched = await dispatchCron<{ count: number | null }>("/api/cron/reference-refresh", {
      kind: "event-directory",
      year,
      preferOrgIds: [orgId],
    });
    if (!dispatched.ok) {
      return Response.json({ ok: true, pending: true, count: null }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ok: true, count: dispatched.body.count }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: publicErrorMessage(error, "Published events couldn't be refreshed. Your saved events are still available; you can add an unlisted event.") }, { status: 400 });
  }
}
