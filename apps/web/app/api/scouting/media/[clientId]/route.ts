import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../../lib/scouting-auth";

const MAX_SCOUT_MEDIA_BYTES = 6 * 1024 * 1024;

export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params;
    const orgId = new URL(request.url).searchParams.get("orgId");
    const content = Buffer.from(await request.arrayBuffer());
    if (!content.byteLength || content.byteLength > MAX_SCOUT_MEDIA_BYTES) {
      return Response.json(
        { error: `Media must be between 1 byte and ${MAX_SCOUT_MEDIA_BYTES} bytes` },
        { status: 400 },
      );
    }
    await withScoutingRequest(orgId, async (client) => {
      const updated = await client.query(
        `UPDATE scout_media
         SET status = 'uploaded',
             bytes = $3,
             byte_size = $4,
             updated_at = now()
         WHERE org_id = $1
           AND client_id = $2
           AND storage_key LIKE $1::text || '/%'
         RETURNING id`,
        [orgId, clientId, content, content.byteLength],
      );
      if (!updated.rowCount) {
        throw new Error("Media metadata not found for this organization");
      }
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

/** Serve org-isolated robot / pit media bytes to authenticated members. */
export async function GET(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params;
    const orgId = new URL(request.url).searchParams.get("orgId");
    const row = await withScoutingRequest(orgId, async (client) => {
      const result = await client.query<{
        contentType: string;
        bytes: Buffer | null;
      }>(
        `SELECT content_type AS "contentType", bytes
         FROM scout_media
         WHERE org_id = $1
           AND client_id = $2
           AND status = 'uploaded'
           AND storage_key LIKE $1::text || '/%'
         LIMIT 1`,
        [orgId, clientId],
      );
      return result.rows[0] ?? null;
    });
    if (!row?.bytes) {
      return Response.json({ error: "Media not found" }, { status: 404 });
    }
    return new Response(new Uint8Array(row.bytes), {
      status: 200,
      headers: {
        "Content-Type": row.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
