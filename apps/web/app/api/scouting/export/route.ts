import { loadMatchScoutingExport, matchScoutingCsv } from "../../../../lib/scouting/scout-export";
import { ScoutingHttpError, withScoutingRequest } from "../../../../lib/scouting-auth";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * GET /api/scouting/export?orgId=…&eventKey=… — every match scouting report at
 * the event as one CSV, answers included. Team members only (withRls + the
 * membership check in withScoutingRequest).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const csv = await withScoutingRequest(orgId, async (client) => {
      let eventKey = url.searchParams.get("eventKey")?.trim() || null;
      if (!eventKey) {
        const active = await client.query<{ eventKey: string | null }>(
          `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
          [orgId],
        );
        eventKey = active.rows[0]?.eventKey ?? null;
      }
      if (!eventKey) throw new ScoutingHttpError(400, "Pick your event first.");
      const data = await loadMatchScoutingExport(client, { orgId: orgId as string, eventKey });
      return { eventKey, text: matchScoutingCsv(data) };
    });
    const safeName = csv.eventKey.replace(/[^\w.-]+/g, "-");
    return new Response(csv.text, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${safeName}-match-scouting.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ScoutingHttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: publicErrorMessage(error, "Could not build the scouting export") }, { status: 500 });
  }
}
