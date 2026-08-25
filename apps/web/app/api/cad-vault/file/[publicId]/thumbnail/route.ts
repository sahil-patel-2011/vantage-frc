import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export const runtime = "nodejs";

/** Serve the stored STL thumbnail PNG; 404 when none was rendered or on any miss. */
export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response(null, { status: 404 });
  const { publicId } = await params;

  try {
    const version = await withRls({ userId: session.user.id }, (client) =>
      client.query<{ thumbnail: Uint8Array | null }>(
        `SELECT v.thumbnail_png AS "thumbnail"
         FROM cad_document_versions v
         WHERE v.public_id = $1::uuid
           AND v.org_id IN (SELECT m.org_id FROM memberships m WHERE m.user_id = $2)`,
        [publicId, session.user.id],
      ),
    );
    const thumbnail = version.rows[0]?.thumbnail;
    if (!thumbnail) return new Response(null, { status: 404 });
    const body = new ArrayBuffer(thumbnail.byteLength);
    new Uint8Array(body).set(thumbnail);
    return new Response(body, {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
