import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export const runtime = "nodejs";

/**
 * Stream a stored CAD file. RLS scopes rows to the caller's orgs, and the
 * membership predicate is repeated explicitly in SQL. A miss — including a
 * foreign org's public_id — is a 404, never a 403, so ids are unprobeable.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response(null, { status: 404 });
  const { publicId } = await params;

  try {
    const version = await withRls({ userId: session.user.id }, (client) =>
      client.query<{ filename: string; mediaType: string; bytes: Uint8Array }>(
        `SELECT v.filename, v.media_type AS "mediaType", v.bytes
         FROM cad_document_versions v
         WHERE v.public_id = $1::uuid
           AND v.org_id IN (SELECT m.org_id FROM memberships m WHERE m.user_id = $2)`,
        [publicId, session.user.id],
      ),
    );
    const row = version.rows[0];
    if (!row) return new Response(null, { status: 404 });
    const body = new ArrayBuffer(row.bytes.byteLength);
    new Uint8Array(body).set(row.bytes);
    return new Response(body, {
      headers: {
        "content-type": row.mediaType,
        "content-length": String(row.bytes.byteLength),
        "content-disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
