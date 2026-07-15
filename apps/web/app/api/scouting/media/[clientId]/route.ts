import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../../lib/scouting-auth";

export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params;
    const orgId = new URL(request.url).searchParams.get("orgId");
    const content = await request.arrayBuffer();
    await withScoutingRequest(orgId, (client) =>
      client.query(
        `UPDATE scout_media SET status='uploaded',updated_at=now()
         WHERE org_id=$1 AND client_id=$2 AND byte_size=$3`,
        [orgId, clientId, content.byteLength],
      ),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
